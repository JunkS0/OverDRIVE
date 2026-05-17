# OVERDRIVE - 오픈월드 멀티플레이 드라이빙 시뮬레이션

![OVERDRIVE](https://img.shields.io/badge/version-0.1.0--alpha-blue)
![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-green)

## 개요

OVERDRIVE는 3D 오픈월드 환경에서 실시간 멀티플레이 드라이빙을 즐길 수 있는 웹 기반 게임입니다.
Three.js 기반의 3D 그래픽과 소켓 기반의 실시간 네트워킹으로 여러 플레이어와 함께 자유롭게 드라이빙할 수 있습니다.

## 주요 기능

- **3인칭 드라이빙**: 차량 뒤쪽 상단에서의 시점
- **다양한 차량**: 오토바이, BMW M3, 아이오닉 5 N
- **실시간 멀티플레이**: Socket.IO 기반의 저지연 네트워킹
- **자유주행 모드**: 제약 없이 오픈월드 탐험
- **수동/자동 변속**: 두 가지 변속 모드 지원
- **동적 카메라**: 차량의 움직임에 따라 자동으로 조정
- **모바일 지원**: 터치 입력 지원

## 설치 및 실행

### 사전 요구사항
- Node.js 20.0.0 이상
- npm 또는 yarn

### 로컬 환경에서 실행

1. **저장소 클론**
```bash
cd OverDRIVE
```

2. **의존성 설치**
```bash
npm install
```

3. **개발 서버 시작**
```bash
npm run dev
```

4. **클라이언트 실행**
새 터미널에서:
```bash
npm run client
```

5. **브라우저에서 접속**
```
http://localhost:5173
```

## 프로젝트 구조

```
OverDRIVE/
├── server/
│   └── server.js           # Node.js 게임 서버 (Express + Socket.IO)
├── public/
│   ├── models/             # 3D 모델 파일 (.glb)
│   │   ├── bmw_m3.glb
│   │   ├── motorcycle.glb
│   │   └── ionic5n.glb
│   └── city.glb            # 도시 환경 모델
├── client/
│   └── index.html          # 메인 게임 클라이언트
├── package.json
├── render.yaml             # Render.com 배포 설정
└── README.md
```

## 조작 방법

### 키보드 (PC)
- **W / ↑**: 가속
- **S / ↓**: 브레이크
- **A / ←**: 좌회전
- **D / →**: 우회전
- **Shift (좌측)**: 기어 UP (수동 모드)
- **Ctrl (우측)**: 기어 DOWN (수동 모드)
- **ESC**: 일시정지

### 터치 (모바일)
- **좌측 버튼**: 브레이크
- **우측 버튼**: 가속
- **스티어바**: 좌우 조향

## 기술 스택

### 클라이언트
- **Three.js r128**: 3D 그래픽 렌더링
- **Socket.IO Client**: 실시간 통신
- **HTML5/CSS3**: UI/UX

### 서버
- **Node.js 20 LTS**: 런타임
- **Express.js**: 웹 프레임워크
- **Socket.IO 4.x**: WebSocket 기반 실시간 통신
- **Redis**: 세션 및 캐시 관리

## 게임 설정

### 차량 정보
- **오토바이**: 경량, 고속, 높은 조종성
- **BMW M3**: 균형잡힌 고성능 세단
- **아이오닉 5 N**: 전기 고성능 SUV

### 변속 시스템
- **자동 (AUTO)**: RPM 기반으로 자동 변속
- **수동 (MANUAL)**: Shift/Ctrl로 수동 변속

## 성능 목표

- **클라이언트 FPS**: 60fps (PC), 30fps (모바일)
- **서버 Tick Rate**: 20 tick/s
- **동시 접속자**: 최대 64명 (서버당)
- **평균 지연시간**: < 50ms

## 배포

### Render.com에 배포하기

1. **render.yaml 확인**
```yaml
services:
  - type: web
    name: overdrive-game-server
    env: node
    plan: free
    buildCommand: npm ci
    startCommand: npm start
```

2. **배포**
- Render.com에 GitHub 저장소 연결
- 자동으로 배포됨

## 주의사항

- city.glb 파일은 `public/` 폴더에 위치합니다
- 차량 모델은 `public/models/` 폴더에 위치합니다
- 서버는 WebSocket과 HTTP polling을 모두 지원합니다

## 라이선스

OVERDRIVE © 2025. All rights reserved.

## 문제 보고 및 제안

문제가 발생하거나 개선 사항이 있으시면 이슈를 등록해주세요.

---

**버전**: 0.1.0-alpha  
**마지막 업데이트**: 2025년 5월
