# 오픈월드 멀티플레이 드라이빙 시뮬레이션 — 시스템 아키텍처

---

## 1. 전체 시스템 구조 (High-Level Architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  PC Browser  │  │Mobile Browser│  │  Native App (Optional) │ │
│  │  (Three.js)  │  │ (Three.js)   │  │      (Tauri/Electron)  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘ │
│         └─────────────────┴──────────────────────┘              │
│                            │                                     │
│               ┌────────────┴──────────┐                         │
│               │    Game Engine Core   │                         │
│               │  (Three.js + Cannon.js│                         │
│               │   + Custom Systems)   │                         │
│               └────────────┬──────────┘                         │
└────────────────────────────┼────────────────────────────────────┘
                             │ WebSocket (Socket.IO)
                             │ REST API (HTTPS)
┌────────────────────────────┼────────────────────────────────────┐
│                      BACKEND LAYER (Render.com)                  │
│                            │                                     │
│         ┌──────────────────┴────────────────────┐               │
│         │         Game Server (Node.js)          │               │
│         │  ┌─────────────┐  ┌─────────────────┐ │               │
│         │  │ Socket.IO   │  │   REST API       │ │               │
│         │  │ (Realtime)  │  │ (Auth/Lobby/Data)│ │               │
│         │  └──────┬──────┘  └────────┬─────────┘ │               │
│         │         │                  │            │               │
│         │  ┌──────┴──────────────────┴──────────┐ │               │
│         │  │         Game State Manager         │ │               │
│         │  │  - World State (Free Roam)          │ │               │
│         │  │  - Race State (Race Mode)           │ │               │
│         │  │  - Player Registry                 │ │               │
│         │  └──────────────────────────────────── │               │
│         └──────────────────────────────────────── │               │
│                                                    │               │
│         ┌──────────────────────────────────────┐   │               │
│         │           Database Layer              │   │               │
│         │  ┌──────────────┐  ┌──────────────┐  │   │               │
│         │  │  PostgreSQL  │  │    Redis     │  │   │               │
│         │  │ (Persistent) │  │  (Session/   │  │   │               │
│         │  │              │  │   Cache)     │  │   │               │
│         │  └──────────────┘  └──────────────┘  │   │               │
│         └──────────────────────────────────────┘   │               │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. 클라이언트 아키텍처

### 2.1 모듈 구조

```
/client
├── /core
│   ├── Engine.js           # 메인 게임 루프, Three.js 씬 관리
│   ├── AssetLoader.js      # GLTF/텍스처/오디오 에셋 로딩
│   ├── InputManager.js     # PC/모바일 입력 통합 처리
│   └── NetworkManager.js   # Socket.IO 연결 및 메시지 처리
│
├── /systems
│   ├── PhysicsSystem.js    # Cannon.js 물리 월드 관리
│   ├── VehicleSystem.js    # 차량 물리/제어 시스템
│   ├── WorldSystem.js      # 오픈월드 청크 로딩
│   ├── RaceSystem.js       # 레이싱 모드 로직
│   └── AudioSystem.js      # 엔진음/환경음
│
├── /vehicles
│   ├── Vehicle.js          # 기본 차량 클래스
│   ├── Motorcycle.js       # 오토바이 (extends Vehicle)
│   ├── BMWM3.js            # BMW M3 (extends Vehicle)
│   └── IonicN5.js          # 아이오닉 5 N (extends Vehicle)
│
├── /network
│   ├── Interpolator.js     # 위치 보간 (Dead Reckoning)
│   ├── RemotePlayer.js     # 원격 플레이어 차량 렌더링
│   └── Reconciler.js       # 서버-클라이언트 상태 조정
│
├── /ui
│   ├── HUD.js              # 인게임 HUD (속도계, 기어, 미니맵)
│   ├── MainMenu.js         # 메인 로비 UI
│   ├── Garage.js           # 차고/차량 선택 UI
│   ├── PauseMenu.js        # ESC 일시정지 메뉴
│   └── RaceUI.js           # 레이싱 모드 UI (랩타임, 순위)
│
└── /utils
    ├── MathUtils.js
    └── Constants.js
```

### 2.2 게임 루프 (60fps 고정 타겟)

```
GameLoop:
  fixedUpdate(16.67ms):
    → InputManager.poll()
    → PhysicsSystem.step()        ← Cannon.js (sub-step)
    → VehicleSystem.update()      ← 차량 물리 적용
    → NetworkManager.sendState()  ← 위치/속도 서버 전송 (20tick/s)
  
  render(requestAnimationFrame):
    → WorldSystem.cullAndLoad()   ← 카메라 기준 청크 관리
    → RemotePlayers.interpolate() ← 보간으로 부드러운 이동
    → Three.js renderer.render()
    → HUD.update()
```

---

## 3. 차량 물리 시스템

### 3.1 Cannon.js RaycastVehicle 기반

```javascript
// 차량 물리 파라미터 예시 (BMW M3)
const vehicleConfig = {
  mass: 1600,               // kg
  chassis: { w:2.0, h:0.6, d:4.7 },
  wheelOptions: {
    radius: 0.35,
    directionLocal: [0,-1,0],
    suspensionStiffness: 50,
    suspensionRestLength: 0.3,
    frictionSlip: 1.8,
    dampingRelaxation: 2.3,
    dampingCompression: 4.5,
    maxSuspensionForce: 100000,
    rollInfluence: 0.01
  }
}
```

### 3.2 아날로그 입력 시스템

```
PC (키보드):          0 or 1 (이진)
PC (게임패드/휠):     0.0 ~ 1.0 (아날로그, 압력 감지)
모바일 (터치):        터치 영역 내 Y-좌표 → 0.0 ~ 1.0 매핑
                      (터치 누름 깊이 시뮬레이션)
```

### 3.3 변속기 시스템

```
수동(Manual):
  클러치 입력 → 기어 입력 → 클러치 해제
  기어비: [R:-3.5, N:0, 1:3.42, 2:2.14, 3:1.49, 4:1.11, 5:0.85, 6:0.67]
  RPM 범위: 800(공회전) ~ 8000(레드라인)

자동(Auto):
  현재 RPM + 속도 기반 자동 변속 로직
  변속 시점: 업시프트 85%, 다운시프트 35% RPM
```

---

## 4. 네트워크 아키텍처

### 4.1 저지연 동기화 전략

```
클라이언트-서버 권위 모델:
  - 클라이언트: 로컬 물리 시뮬레이션 (즉각 반응)
  - 서버: 위치/속도 검증 및 브로드캐스트
  - 전송 주기: 20 tick/s (50ms 간격)
  - 보간 방식: Dead Reckoning + Hermite 보간

패킷 구조 (바이너리 최적화):
  [playerId:4B][x:4B][y:4B][z:4B][qx:2B][qy:2B][qz:2B][qw:2B]
  [vx:2B][vy:2B][vz:2B][gear:1B][rpm:2B][steer:1B] = 35 bytes/tick
```

### 4.2 Socket.IO 이벤트 정의

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| `player:join` | C→S | 월드 입장 요청 |
| `player:spawn` | S→C | 스폰 위치 수신 |
| `vehicle:state` | C→S | 차량 상태 업로드 (20/s) |
| `world:snapshot` | S→C | 전체 플레이어 스냅샷 (10/s) |
| `race:start` | S→C | 레이스 시작 신호 |
| `race:checkpoint` | C→S | 체크포인트 통과 보고 |
| `race:finish` | S→C | 완주 결과 수신 |
| `chat:message` | C↔S | 채팅 |

### 4.3 Render.com 백엔드 구성

```yaml
# render.yaml
services:
  - type: web
    name: driving-game-server
    env: node
    plan: standard          # 1 CPU, 2GB RAM
    buildCommand: npm install
    startCommand: node server/index.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: REDIS_URL
        fromService:
          name: game-redis
          property: connectionString
    
  - type: redis
    name: game-redis
    plan: starter
    
  - type: pserv              # Private service (no public port)
    name: physics-worker    # 충돌 검증 전용 워커
```

---

## 5. 오픈월드 청크 시스템

```
월드 분할:
  전체 맵: 20km × 20km
  청크 크기: 500m × 500m = 1,600 청크
  
로딩 전략:
  ┌─────────────────────────┐
  │  [원거리: LOD2 저해상도] │
  │  ┌───────────────────┐  │
  │  │ [중거리: LOD1]    │  │
  │  │  ┌─────────────┐  │  │
  │  │  │[현재: LOD0] │  │  │
  │  │  │  ★ Player  │  │  │
  │  │  └─────────────┘  │  │
  │  └───────────────────┘  │
  └─────────────────────────┘
  
  활성 청크: 반경 3 (9개 청크)
  LOD1 청크: 반경 5 (25개 청크)  
  LOD2 청크: 반경 8 (64개 청크)
```

---

## 6. UI 플로우

```
[앱 시작]
    │
    ▼
[메인 메뉴]──────────────────────────────────────
    │                                             │
    ├─ [멀티플레이 입장]                          │
    │       │                                     │
    │       ▼                                     │
    │  [서버 로비] ─ 자유주행 / 레이스 선택       │
    │       │                                     │
    │       ▼                                     │
    │  [인게임]                                   │
    │       │ ESC                                 │
    │       ▼                                     │
    │  [일시정지 메뉴]                            │
    │       ├─ 계속하기                           │
    │       ├─ 설정                               │
    │       └─ 메인 메뉴로 나가기 ───────────────┘
    │
    ├─ [차고 (차량 선택)]
    │       ├─ 오토바이
    │       ├─ BMW M3
    │       └─ 아이오닉 5 N
    │
    └─ [언어 설정]
            ├─ 한국어
            ├─ English
            └─ 日本語 / ...
```

---

## 7. 기술 스택 요약

| 레이어 | 기술 |
|--------|------|
| 3D 렌더링 | Three.js r165 |
| 물리 엔진 | Cannon-es (Cannon.js 포크) |
| 네트워크 | Socket.IO 4.x (WebSocket) |
| 백엔드 런타임 | Node.js 20 LTS |
| 백엔드 프레임워크 | Express.js |
| 세션/캐시 | Redis 7 |
| 데이터베이스 | PostgreSQL 16 |
| 호스팅 | Render.com |
| 번들러 | Vite 5 |
| 모바일 터치 UI | Custom Canvas Overlay |

---

## 8. 성능 목표

| 지표 | 목표 |
|------|------|
| 클라이언트 FPS | 60fps (PC), 30fps (모바일) |
| 서버 Tick Rate | 20 tick/s |
| 동시 접속자 (서버당) | 최대 64명 |
| 평균 지연시간 (한국 기준) | < 50ms |
| 초기 로딩 시간 | < 8초 |
| 차량 상태 패킷 크기 | < 40 bytes |
