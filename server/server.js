/**
 * OVERDRIVE — 멀티플레이 게임 서버
 * Node.js 20 + Express + Socket.IO
 * 배포: Render.com (render.yaml 참조)
 */

'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');

const app = express();
const server = http.createServer(app);

/* ── Socket.IO 설정 ── */
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(express.json());

/* ── Redis 연결 ── */
let redis = null;
if (process.env.REDIS_URL) {
  redis = createClient({ url: process.env.REDIS_URL });
  redis.on('error', err => console.error('[Redis]', err));
  redis.connect().then(() => console.log('[Redis] 연결됨'));
}

/* ══════════════════════════════════════════════
   GAME STATE MANAGER
   ══════════════════════════════════════════════ */

/**
 * 서버 내 플레이어 레지스트리
 * key: socket.id, value: PlayerData
 */
const players = new Map();

/**
 * 레이스 세션 레지스트리
 * key: raceId (string), value: RaceSession
 */
const raceSessions = new Map();

/**
 * @typedef {Object} PlayerData
 * @property {string} id           socket.id
 * @property {string} playerId     UUID
 * @property {string} vehicleId    'motorcycle' | 'bmw_m3' | 'ionic5n'
 * @property {string} mode         'free_roam' | 'racing'
 * @property {string|null} raceId  현재 참가 중인 레이스 ID
 * @property {VehicleState} state  마지막으로 받은 차량 상태
 * @property {number} lastSeen     타임스탬프
 * @property {number} ping         ms
 */

/**
 * @typedef {Object} VehicleState
 * @property {number} x quat_x
 * @property {number} y quat_y
 * @property {number} z quat_z
 * @property {number} qx
 * @property {number} qy
 * @property {number} qz
 * @property {number} qw
 * @property {number} vx velocity x
 * @property {number} vy
 * @property {number} vz
 * @property {number} gear
 * @property {number} rpm
 * @property {number} steer  -127 ~ 127
 */

/* ══════════════════════════════════════════════
   RACE SESSION MANAGER
   ══════════════════════════════════════════════ */
class RaceSession {
  constructor(id, route, maxPlayers = 8) {
    this.id = id;
    this.route = route;         // 체크포인트 배열 [{x,y,z}]
    this.maxPlayers = maxPlayers;
    this.players = new Map();   // playerId → { gear, checkpoints, bestLap }
    this.state = 'waiting';     // waiting | countdown | active | finished
    this.startTime = null;
    this.results = [];
    this.countdownTimer = null;
  }

  addPlayer(playerId, socketId) {
    if (this.players.size >= this.maxPlayers) return false;
    this.players.set(playerId, {
      socketId,
      checkpoints: 0,
      lap: 1,
      lapTimes: [],
      finishTime: null,
    });
    return true;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    if (this.players.size === 0) raceSessions.delete(this.id);
  }

  startCountdown() {
    this.state = 'countdown';
    let count = 3;
    io.to(this.id).emit('race:countdown', { count });

    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(this.id).emit('race:countdown', { count });
      } else {
        clearInterval(this.countdownTimer);
        this.state = 'active';
        this.startTime = Date.now();
        io.to(this.id).emit('race:start', { startTime: this.startTime });
      }
    }, 1000);
  }

  recordCheckpoint(playerId, checkpointIndex) {
    const pd = this.players.get(playerId);
    if (!pd) return;
    if (checkpointIndex !== pd.checkpoints) return; // 순서 검증

    pd.checkpoints++;
    const elapsed = Date.now() - this.startTime;

    // 완주 체크
    if (pd.checkpoints >= this.route.length) {
      if (!pd.finishTime) {
        pd.finishTime = elapsed;
        pd.lap++;
        pd.checkpoints = 0;
        pd.lapTimes.push(elapsed);
        this.results.push({ playerId, time: elapsed });
        io.to(pd.socketId).emit('race:lap', { lap: pd.lap, time: elapsed });
        io.to(this.id).emit('race:checkpoint_broadcast', {
          playerId, rank: this.results.length, time: elapsed
        });
      }
    }
  }

  getStandings() {
    return [...this.players.entries()].map(([pid, pd]) => ({
      playerId: pid,
      checkpoints: pd.checkpoints,
      lap: pd.lap,
      finishTime: pd.finishTime,
    })).sort((a, b) => {
      if (a.finishTime && b.finishTime) return a.finishTime - b.finishTime;
      if (a.finishTime) return -1;
      if (b.finishTime) return 1;
      return b.lap !== a.lap ? b.lap - a.lap : b.checkpoints - a.checkpoints;
    });
  }
}

/* ══════════════════════════════════════════════
   WORLD SNAPSHOT BROADCASTER (10 tick/s)
   서버 측 권위 있는 상태 브로드캐스트
   ══════════════════════════════════════════════ */
const SNAPSHOT_RATE = 100; // ms
setInterval(() => {
  if (players.size < 2) return;

  const snapshot = {
    ts: Date.now(),
    players: []
  };

  for (const [, p] of players) {
    if (!p.state) continue;
    snapshot.players.push({
      id: p.playerId,
      vehicleId: p.vehicleId,
      s: p.state,     // 전체 state 객체
    });
  }

  io.emit('world:snapshot', snapshot);
}, SNAPSHOT_RATE);

/* ══════════════════════════════════════════════
   SOCKET.IO 이벤트 핸들러
   ══════════════════════════════════════════════ */
io.on('connection', (socket) => {
  console.log(`[+] 소켓 연결: ${socket.id}`);

  /* ── 플레이어 입장 ── */
  socket.on('player:join', (data, ack) => {
    /**
     * data: {
     *   playerId: string (uuid),
     *   vehicleId: string,
     *   displayName: string,
     * }
     */
    if (!data?.playerId || !data?.vehicleId) {
      return ack?.({ error: 'invalid_data' });
    }

    // 중복 입장 방지
    if (players.has(socket.id)) return ack?.({ error: 'already_joined' });

    const spawnPos = _getSpawnPosition();
    const player = {
      id: socket.id,
      playerId: data.playerId,
      displayName: data.displayName || 'DRIVER',
      vehicleId: data.vehicleId,
      mode: 'free_roam',
      raceId: null,
      state: {
        x: spawnPos.x, y: 0, z: spawnPos.z,
        qx: 0, qy: 0, qz: 0, qw: 1,
        vx: 0, vy: 0, vz: 0,
        gear: 1, rpm: 800, steer: 0,
      },
      lastSeen: Date.now(),
      ping: 0,
    };

    players.set(socket.id, player);

    // 스폰 위치 응답
    ack?.({
      ok: true,
      spawn: spawnPos,
      playerCount: players.size,
      nearbyPlayers: _getNearbyPlayers(spawnPos, socket.id, 500),
    });

    // 다른 플레이어들에게 알림
    socket.broadcast.emit('player:joined', {
      id: player.playerId,
      vehicleId: player.vehicleId,
      displayName: player.displayName,
      spawn: spawnPos,
    });

    console.log(`[Join] ${player.displayName} (${player.vehicleId}) | 총 ${players.size}명`);
  });

  /* ── 차량 상태 업로드 (20 tick/s) ── */
  socket.on('vehicle:state', (state) => {
    const player = players.get(socket.id);
    if (!player) return;

    // 서버 측 기본 검증
    if (!_validateVehicleState(state)) return;

    player.state = state;
    player.lastSeen = Date.now();
  });

  /* ── Ping ── */
  socket.on('ping:req', (ts) => {
    socket.emit('ping:res', ts);
  });

  /* ── 레이스 입장 요청 ── */
  socket.on('race:join', (data, ack) => {
    const player = players.get(socket.id);
    if (!player) return ack?.({ error: 'not_joined' });
    if (player.raceId) return ack?.({ error: 'already_in_race' });

    let race = raceSessions.get(data.raceId);
    if (!race) {
      // 새 레이스 세션 생성
      race = new RaceSession(
        data.raceId || `race_${Date.now()}`,
        RACE_ROUTES[data.routeId || 'city_sprint'] || RACE_ROUTES.city_sprint,
      );
      raceSessions.set(race.id, race);
    }

    const ok = race.addPlayer(player.playerId, socket.id);
    if (!ok) return ack?.({ error: 'race_full' });

    player.raceId = race.id;
    player.mode = 'racing';
    socket.join(race.id); // Socket.IO 룸

    ack?.({ ok: true, raceId: race.id, route: race.route });

    // 최소 인원 충족 시 카운트다운 시작
    if (race.players.size >= 2 && race.state === 'waiting') {
      race.startCountdown();
    }
  });

  /* ── 체크포인트 통과 ── */
  socket.on('race:checkpoint', (data) => {
    const player = players.get(socket.id);
    if (!player?.raceId) return;
    const race = raceSessions.get(player.raceId);
    if (!race || race.state !== 'active') return;

    race.recordCheckpoint(player.playerId, data.index);

    // 현재 순위 브로드캐스트
    io.to(race.id).emit('race:standings', race.getStandings());
  });

  /* ── 레이스 퇴장 ── */
  socket.on('race:leave', () => {
    _removeFromRace(socket);
  });

  /* ── 채팅 ── */
  socket.on('chat:message', (msg) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (typeof msg !== 'string' || msg.length > 120) return;

    const sanitized = msg.replace(/[<>]/g, '').trim();
    if (!sanitized) return;

    io.emit('chat:message', {
      from: player.displayName,
      playerId: player.playerId,
      text: sanitized,
      ts: Date.now(),
    });
  });

  /* ── 연결 해제 ── */
  socket.on('disconnect', (reason) => {
    const player = players.get(socket.id);
    if (player) {
      _removeFromRace(socket);
      players.delete(socket.id);
      socket.broadcast.emit('player:left', { id: player.playerId });
      console.log(`[-] ${player.displayName} 퇴장 (${reason}) | 잔여 ${players.size}명`);
    }
  });
});

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */
function _getSpawnPosition() {
  // 도시 시작 구역 내 랜덤 스폰
  const SPAWN_POINTS = [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: -10, y: 0, z: 0 },
    { x: 0, y: 0, z: 15 },
    { x: 0, y: 0, z: -15 },
  ];
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

function _getNearbyPlayers(pos, excludeSocketId, radius) {
  const result = [];
  for (const [sid, p] of players) {
    if (sid === excludeSocketId) continue;
    const dx = p.state.x - pos.x;
    const dz = p.state.z - pos.z;
    if (Math.sqrt(dx * dx + dz * dz) < radius) {
      result.push({
        id: p.playerId,
        vehicleId: p.vehicleId,
        state: p.state,
      });
    }
  }
  return result;
}

function _validateVehicleState(s) {
  if (!s || typeof s !== 'object') return false;
  // 기본 범위 체크
  if (Math.abs(s.x) > 20000 || Math.abs(s.z) > 20000) return false;
  if (s.rpm < 0 || s.rpm > 20000) return false;
  return true;
}

function _removeFromRace(socket) {
  const player = players.get(socket.id);
  if (!player?.raceId) return;
  const race = raceSessions.get(player.raceId);
  if (race) {
    race.removePlayer(player.playerId);
    socket.leave(race.id);
    io.to(race.id).emit('race:player_left', { playerId: player.playerId });
  }
  player.raceId = null;
  player.mode = 'free_roam';
}

/* ══════════════════════════════════════════════
   RACE ROUTE 데이터 (체크포인트 좌표)
   ══════════════════════════════════════════════ */
const RACE_ROUTES = {
  city_sprint: {
    name: '도심 스프린트',
    checkpoints: [
      { x: 0, y: 0, z: 100 },
      { x: 50, y: 0, z: 200 },
      { x: 0, y: 0, z: 350 },
      { x: -50, y: 0, z: 450 },
      { x: 0, y: 0, z: 600 },
    ],
  },
  highway_loop: {
    name: '고속도로 루프',
    checkpoints: [
      { x: 0, y: 0, z: 200 },
      { x: 100, y: 0, z: 500 },
      { x: 200, y: 0, z: 800 },
      { x: 100, y: 0, z: 1100 },
      { x: 0, y: 0, z: 1400 },
      { x: -100, y: 0, z: 1100 },
      { x: 0, y: 0, z: 0 },
    ],
  },
};

/* ══════════════════════════════════════════════
   REST API
   ══════════════════════════════════════════════ */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    players: players.size,
    races: raceSessions.size,
    uptime: process.uptime(),
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    playerCount: players.size,
    activeRaces: raceSessions.size,
    timestamp: Date.now(),
  });
});

app.get('/api/leaderboard', async (req, res) => {
  if (!redis) return res.json({ entries: [] });
  try {
    const keys = await redis.keys('lb:*');
    const entries = await Promise.all(
      keys.map(async k => {
        const val = await redis.get(k);
        return JSON.parse(val);
      })
    );
    entries.sort((a, b) => a.bestTime - b.bestTime);
    res.json({ entries: entries.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

/* ══════════════════════════════════════════════
   서버 시작
   ══════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   OVERDRIVE Game Server v0.1.0       ║
  ║   포트: ${PORT}                          ║
  ║   환경: ${process.env.NODE_ENV || 'development'}              ║
  ╚══════════════════════════════════════╝
  `);
});

/* ══════════════════════════════════════════════
   Graceful Shutdown
   ══════════════════════════════════════════════ */
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM 수신 — 종료 중...');
  io.emit('server:shutdown', { message: '서버가 재시작됩니다.' });
  setTimeout(() => {
    server.close(() => {
      redis?.quit();
      process.exit(0);
    });
  }, 2000);
});

module.exports = { app, server, io };
