<div align="right">
  <strong>English</strong> | <a href="README.pt-BR.md">Português</a>
</div>

# Bedrock Autonomous Agent ⚡📦

[![Runtime](https://img.shields.io/badge/Runtime-Node.js%2018%2B-green.svg)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/Protocol-bedrock--protocol%20(UDP)-red.svg)](https://github.com/PrismarineJS/bedrock-protocol)
[![Target](https://img.shields.io/badge/Target-BDS%201.26.x-blue.svg)](https://www.minecraft.net/en-us/download/server/bedrock)
[![Status](https://img.shields.io/badge/Status-Experimental%20R%26D-orange.svg)]()
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)

> **Low-Level Native Bedrock Dedicated Server (BDS) UDP Protocol Agent & Finite State Machine.**  
> An experimental research engine interfacing directly with Minecraft Bedrock's binary packet stream (`RakNet` / `bedrock-protocol`) for autonomous state tracking, reconnection backoff, and chat-driven dispatch.

---

## 📌 Protocol Architecture & Packet Flow

Unlike Java Edition's TCP stream, Bedrock Edition operates over raw UDP/RakNet datagrams. The agent communicates directly with the binary wire protocol.

```mermaid
flowchart TD
    subgraph BDS["Bedrock Dedicated Server (BDS)"]
        RakNet["RakNet Datagram Stream<br/>(UDP 19132)"]
    end

    subgraph PROTOCOL_LAYER["Binary Packet Dissection Tier"]
        Listener["bedrock-protocol Connection Adapter"]
        PacketHandler["Real-Time Packet Decoders<br/>(Entities, Chunk Data, Player Auth)"]
        RakNet <--> Listener
        Listener --> PacketHandler
    end

    subgraph FSM["Finite State Machine & Action Engine"]
        StateStore["Global State Store<br/>(Single Source of Truth)"]
        Survival["Survival Module<br/>(Auto-Eat, Critical HP Retreat)"]
        Combat["Combat Heuristics<br/>(Chase & Melee Packet Dispatch)"]
        Navigation["Exploration Loop<br/>(Golden Spiral & Coordinate Traversal)"]
        Reconnector["Connection Manager<br/>(Exponential Backoff Reconnect)"]
        
        PacketHandler --> StateStore
        StateStore --> Survival
        StateStore --> Combat
        StateStore --> Navigation
        Reconnector -.-> Listener
    end

    subgraph COMMANDS["Command Plane"]
        ChatRouter["Chat Command Dispatcher (!prefix)"]
        StateStore --> ChatRouter
    end
```

---

## 🔬 Experimental Research & Status

> [!NOTE]
> **Active Research Phase:** This project explores reverse-engineered Bedrock client kinematics, entity synchronization, and non-blocking UDP packet handlers.

### Key Capabilities Implemented
- **Binary Handshake & Version Negotiation:** Dynamically negotiates version payloads across BDS `1.26.x` minor releases.
- **Resilient Reconnection Loop:** Exponential backoff strategy preventing IP ban rates on unexpected network drops.
- **Low-Overhead Packet Actions:** Dispatches native attack, look, and inventory transactions without high-level abstraction bloat.
- **Autonomous Subroutines:** Golden spiral search pattern for mob engagement and autonomous food consumption.

---

## 🛠️ Execution

```bash
# 1. Clone repository
git clone https://github.com/welzim19-star/bedrock-autonomous-agent.git
cd bedrock-autonomous-agent

# 2. Install dependencies
npm install

# 3. Launch agent
node index.js
```

---

## ⚖️ License
Distributed under the **MIT License**.
