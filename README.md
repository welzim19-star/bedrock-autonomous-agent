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
    subgraph BDS["Bedrock Dedicated Server"]
        RakNet["RakNet Datagram Stream"]
    end

    subgraph PROTOCOL_LAYER["Packet Dissection Tier"]
        Listener["Connection Adapter"]
        PacketHandler["Packet Decoders"]
        RakNet <--> Listener
        Listener --> PacketHandler
    end

    subgraph FSM["Finite State Machine"]
        StateStore["Global State Store"]
        Survival["Survival Module"]
        Combat["Combat Heuristics"]
        Navigation["Exploration Loop"]
        Reconnector["Connection Manager"]
        
        PacketHandler --> StateStore
        StateStore --> Survival
        StateStore --> Combat
        StateStore --> Navigation
        Reconnector -.-> Listener
    end

    subgraph COMMANDS["Command Plane"]
        ChatRouter["Chat Command Dispatcher"]
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
