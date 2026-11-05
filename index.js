// ============================================================================
// MINEBOT_SSJ3 — BEDROCK CORE v2.1
// Stack: Node.js + bedrock-protocol (GitHub/PrismarineJS — suporte 1.26.x)
// Compatível: BDS 1.26.x + Celular Bedrock 1.26.x na mesma rede LAN
// ============================================================================
// MÓDULOS:
//   1.  Configuração Central
//   2.  Estado Global (Single Source of Truth)
//   3.  Logger Visual (chalk)
//   4.  Ações Primitivas (abstração sobre packets Bedrock)
//   5.  Sobrevivência (auto-eat, equipar arma, fuga de HP crítico)
//   6.  Combate PVP/PVE (perseguição, ataque, defesa reativa)
//   7.  Movimentação e Exploração (seguir, espiral áurea, ir a coords)
//   8.  Guarda Autônoma (anti-mob) e Anti-AFK
//   9.  Roteador de Comandos de Chat (!prefixo)
//  10.  Handlers de Packets (estado do mundo em tempo real)
//  11.  Gerenciador de Conexão (auto-reconexão com backoff)
//  12.  Entrada
// ============================================================================
// PRINCÍPIOS:
//   - Não-Regressão: nenhuma feature é removida entre versões
//   - Engenharia de Primitivas: fallback para packet bruto se a lib falhar
//   - Zero Trust: toda entidade é validada antes de ser usada
// ============================================================================

'use strict';

const bedrock = require('bedrock-protocol');
const chalk   = require('chalk');

// ============================================================================
// SEÇÃO 1 — CONFIGURAÇÃO CENTRAL
// ============================================================================
const CONFIG = {
    // ── Rede ──────────────────────────────────────────────────────────────
    host:     '127.0.0.1',     // IP do BDS. Troque pelo IP LAN (ex: 192.168.1.10)
    port:     19132,            // Porta UDP padrão Bedrock (não mude sem motivo)
    username: 'Minebot_SSJ3',  // Nome exibido no servidor
    offline:  true,             // true = servidor sem autenticação Xbox Live

    // ── Versão ────────────────────────────────────────────────────────────
    // Seu BDS: 1.26.14.1 | Celular: 1.26.13
    // null = auto-negociação de versão com o servidor (recomendado)
    version:  null,

    // ── Reconexão ─────────────────────────────────────────────────────────
    reconexao: {
        maxTentativas: 10,
        intervaloMs:   5000
    },

    // ── Combate ───────────────────────────────────────────────────────────
    combate: {
        ataqueIntervaloMs: 550,
        alcanceAtaqueBlk:  3.5,
        hpFugaMinimo:      4,
        guardaRaioBlk:     8
    },

    // ── Anti-AFK ──────────────────────────────────────────────────────────
    antiAfk: {
        intervaloMs: 50000
    }
};

// ============================================================================
// SEÇÃO 2 — ESTADO GLOBAL (Single Source of Truth)
// ============================================================================
const STATE = {
    client:              null,
    runtimeId:           BigInt(0),
    posicao:             { x: 0, y: 64, z: 0 },
    rotacao:             { pitch: 0, yaw: 0 },
    health:              20,
    maxHealth:           20,
    food:                20,
    onGround:            true,
    entities:            new Map(),
    players:             new Map(),
    inventory:           new Map(),
    hotbarSlot:          0,
    modoGuarda:          true,
    emCombate:           false,
    alvoAtual:           null,
    reconexaoTentativas: 0,
    intervaloCombate:    null,
    intervaloSeguir:     null,
    intervaloExplora:    null,
    ultimoMovimento:     Date.now()
};

// ============================================================================
// SEÇÃO 3 — LOGGER VISUAL
// ============================================================================
const posStr = () =>
    `(${STATE.posicao.x.toFixed(1)}, ${STATE.posicao.y.toFixed(1)}, ${STATE.posicao.z.toFixed(1)})`;

const log = {
    info:   (m) => console.log(chalk.cyan(`[INFO]   ${m}`)),
    ok:     (m) => console.log(chalk.green(`[OK]     ${m}`)),
    pvp:    (m) => console.log(chalk.red.bold(`[PVP]    ${m}`)),
    missao: (m) => console.log(chalk.yellow(`[MISSÃO] ${m}`)),
    erro:   (m) => console.log(chalk.bgRed.white(`[ERRO]   ${m}`)),
    aviso:  (m) => console.log(chalk.magenta(`[AVISO]  ${m}`)),
    status: ()  => console.log(chalk.gray(
        `>> HP: ${STATE.health}/${STATE.maxHealth} | Fome: ${STATE.food} | ` +
        `Pos: ${posStr()} | Entidades: ${STATE.entities.size} | ` +
        `Guarda: ${STATE.modoGuarda ? 'ON' : 'OFF'}`
    ))
};

// ============================================================================
// SEÇÃO 4 — AÇÕES PRIMITIVAS
// ============================================================================
const acao = {

    chat(msg) {
        if (!STATE.client) return;
        try {
            STATE.client.queue('text', {
                type:              'chat',
                needs_translation: false,
                source_name:       CONFIG.username,
                xuid:              '',
                platform_chat_id:  '',
                message:           String(msg)
            });
        } catch (e) { log.erro(`acao.chat: ${e.message}`); }
    },

    moverPara(x, y, z, yaw = STATE.rotacao.yaw, pitch = STATE.rotacao.pitch) {
        if (!STATE.client) return;
        try {
            STATE.posicao         = { x, y, z };
            STATE.ultimoMovimento = Date.now();
            STATE.client.queue('move_player', {
                runtime_id:        STATE.runtimeId,
                position:          { x, y: y + 1.62, z },
                pitch,
                yaw,
                head_yaw:          yaw,
                mode:              0,
                on_ground:         STATE.onGround,
                ridden_runtime_id: BigInt(0),
                cause:             { type: 0, entity_id: BigInt(0) },
                tick:              BigInt(0)
            });
        } catch (e) { log.erro(`acao.moverPara: ${e.message}`); }
    },

    olharPara(tx, ty, tz) {
        const dx    = tx - STATE.posicao.x;
        const dy    = ty - STATE.posicao.y;
        const dz    = tz - STATE.posicao.z;
        const dist  = Math.sqrt(dx * dx + dz * dz);
        const yaw   = -Math.atan2(dx, dz) * (180 / Math.PI);
        const pitch = -Math.atan2(dy, dist) * (180 / Math.PI);
        STATE.rotacao = { pitch, yaw };
        acao.moverPara(STATE.posicao.x, STATE.posicao.y, STATE.posicao.z, yaw, pitch);
    },

    atacar(entityRuntimeId) {
        if (!STATE.client) return;
        try {
            STATE.client.queue('animate', {
                action_id:         1,
                entity_runtime_id: STATE.runtimeId
            });
            STATE.client.queue('interact', {
                action_id:    1,
                to_entity_id: entityRuntimeId,
                position:     { x: 0, y: 0, z: 0 }
            });
        } catch (e) { log.erro(`acao.atacar: ${e.message}`); }
    },

    selecionarSlot(slot) {
        if (!STATE.client || slot < 0 || slot > 8) return;
        try {
            STATE.hotbarSlot = slot;
            STATE.client.queue('player_hotbar', {
                selected_hotbar_slot: slot,
                window_id:            0,
                select_hotbar_slot:   true
            });
        } catch (e) { log.erro(`acao.selecionarSlot: ${e.message}`); }
    },

    usarItem() {
        if (!STATE.client) return;
        const item = STATE.inventory.get(STATE.hotbarSlot);
        if (!item) return;
        try {
            STATE.client.queue('item_use', {
                action_type:      0,
                block_position:   { x: 0, y: 0, z: 0 },
                block_face:       255,
                hotbar_slot:      STATE.hotbarSlot,
                item,
                player_pos:       STATE.posicao,
                click_pos:        { x: 0.5, y: 0.5, z: 0.5 },
                block_runtime_id: 0
            });
        } catch (e) { log.erro(`acao.usarItem: ${e.message}`); }
    },

    respawn() {
        if (!STATE.client) return;
        try {
            STATE.client.queue('respawn', {
                position:          { x: 0, y: 64, z: 0 },
                state:             2,
                runtime_entity_id: STATE.runtimeId
            });
            log.aviso('Respawn solicitado.');
        } catch (e) { log.erro(`acao.respawn: ${e.message}`); }
    }
};

// ============================================================================
// SEÇÃO 5 — MÓDULO DE SOBREVIVÊNCIA
// ============================================================================
const LISTA = {
    alimentos: [
        'golden_apple', 'enchanted_golden_apple',
        'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
        'cooked_salmon', 'cooked_cod', 'bread', 'pumpkin_pie',
        'mushroom_stew', 'suspicious_stew', 'baked_potato',
        'beef', 'porkchop', 'mutton', 'chicken', 'salmon', 'cod',
        'melon_slice', 'carrot', 'potato', 'sweet_berries', 'dried_kelp'
    ],
    armas: [
        'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword',
        'golden_sword',    'wooden_sword',
        'netherite_axe',   'diamond_axe',   'iron_axe',   'stone_axe',
        'golden_axe',      'wooden_axe'
    ],
    hostis: [
        'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
        'witch', 'pillager', 'ravager', 'phantom', 'drowned', 'husk', 'stray',
        'silverfish', 'slime', 'magma_cube', 'blaze', 'ghast', 'wither_skeleton',
        'guardian', 'elder_guardian', 'vindicator', 'evoker', 'vex', 'shulker',
        'hoglin', 'zoglin', 'piglin_brute', 'warden', 'breeze', 'bogged',
        'zombie_villager', 'zombified_piglin'
    ]
};

function buscarItem(lista) {
    for (const [slot, item] of STATE.inventory) {
        if (item && lista.includes(item.name)) return { slot, item };
    }
    return null;
}

function autoEat() {
    if (STATE.food > 14) return;
    const comida = buscarItem(LISTA.alimentos);
    if (!comida) { log.aviso('Sem comida no inventário!'); return; }
    log.ok(`Auto-eat: ${comida.item.name} (fome: ${STATE.food})`);
    acao.selecionarSlot(comida.slot <= 8 ? comida.slot : 0);
    setTimeout(() => acao.usarItem(), 150);
}

function equiparMelhorArma() {
    for (const arma of LISTA.armas) {
        const found = buscarItem([arma]);
        if (found) {
            acao.selecionarSlot(found.slot <= 8 ? found.slot : 0);
            log.ok(`Arma equipada: ${arma}`);
            return true;
        }
    }
    log.aviso('Nenhuma arma. Usando mãos.');
    return false;
}

// ============================================================================
// SEÇÃO 6 — MÓDULO DE COMBATE PVP/PVE
// ============================================================================
function distancia(a, b) {
    if (!a || !b) return Infinity;
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function pararCombate() {
    if (STATE.intervaloCombate) { clearInterval(STATE.intervaloCombate); STATE.intervaloCombate = null; }
    STATE.emCombate = false;
    STATE.alvoAtual = null;
    log.info('Combate encerrado.');
}

function checkSaude() {
    if (STATE.health > CONFIG.combate.hpFugaMinimo || !STATE.emCombate) return;
    log.aviso(`HP CRÍTICO (${STATE.health})! Fugindo!`);
    const alvo = STATE.entities.get(STATE.alvoAtual);
    pararCombate();
    if (alvo) {
        const dx = STATE.posicao.x - alvo.position.x;
        const dz = STATE.posicao.z - alvo.position.z;
        const n  = Math.sqrt(dx * dx + dz * dz) || 1;
        acao.moverPara(STATE.posicao.x + (dx / n) * 12, STATE.posicao.y, STATE.posicao.z + (dz / n) * 12);
    }
    autoEat();
}

function iniciarCombate(entityRuntimeId) {
    const entidade = STATE.entities.get(entityRuntimeId);
    if (!entidade) { log.erro('Entidade não encontrada no cache.'); return; }

    pararCombate(); pararSeguir();
    STATE.emCombate = true;
    STATE.alvoAtual = entityRuntimeId;
    equiparMelhorArma();
    log.pvp(`Combate → ${entidade.username || entidade.name || String(entityRuntimeId)}`);

    STATE.intervaloCombate = setInterval(() => {
        const alvo = STATE.entities.get(entityRuntimeId);
        if (!alvo) { log.ok('Alvo sumiu.'); pararCombate(); return; }

        const dist = distancia(STATE.posicao, alvo.position);
        if (dist > CONFIG.combate.alcanceAtaqueBlk) {
            const dx = alvo.position.x - STATE.posicao.x;
            const dz = alvo.position.z - STATE.posicao.z;
            const n  = Math.sqrt(dx * dx + dz * dz) || 1;
            acao.moverPara(STATE.posicao.x + (dx / n) * 1.8, alvo.position.y, STATE.posicao.z + (dz / n) * 1.8);
        }

        acao.olharPara(alvo.position.x, alvo.position.y + 1, alvo.position.z);
        acao.atacar(entityRuntimeId);
        checkSaude();
    }, CONFIG.combate.ataqueIntervaloMs);
}

function entidadeMaisProxima(filtro = null) {
    let menor = Infinity, alvoId = null;
    for (const [id, e] of STATE.entities) {
        if (filtro && !filtro(e)) continue;
        const d = distancia(STATE.posicao, e.position);
        if (d < menor) { menor = d; alvoId = id; }
    }
    return alvoId;
}

// ============================================================================
// SEÇÃO 7 — MOVIMENTAÇÃO E EXPLORAÇÃO
// ============================================================================
function pararSeguir()  { if (STATE.intervaloSeguir)  { clearInterval(STATE.intervaloSeguir);  STATE.intervaloSeguir  = null; } }
function pararExplorar(){ if (STATE.intervaloExplora) { clearInterval(STATE.intervaloExplora); STATE.intervaloExplora = null; } }
function pararMovimento(){ pararSeguir(); pararExplorar(); log.info('Movimento parado.'); }

function seguirJogador(nome) {
    pararMovimento();
    if (!STATE.players.get(nome)) { acao.chat(`Não consigo ver ${nome}.`); return; }
    log.missao(`Seguindo: ${nome}`);
    STATE.intervaloSeguir = setInterval(() => {
        if (STATE.emCombate) return;
        const p = STATE.players.get(nome);
        if (!p) { pararSeguir(); return; }
        const e = STATE.entities.get(p.runtimeId);
        if (!e) return;
        if (distancia(STATE.posicao, e.position) > 2.5) {
            const dx = e.position.x - STATE.posicao.x;
            const dz = e.position.z - STATE.posicao.z;
            const n  = Math.sqrt(dx * dx + dz * dz) || 1;
            acao.moverPara(STATE.posicao.x + (dx / n) * 1.2, e.position.y, STATE.posicao.z + (dz / n) * 1.2);
        }
    }, 300);
}

let exploStep = 0;
function explorar() {
    pararMovimento(); exploStep = 0;
    log.missao('Exploração autônoma iniciada (espiral áurea).');
    STATE.intervaloExplora = setInterval(() => {
        if (STATE.emCombate) return;
        const angulo = (exploStep * 137.508) * (Math.PI / 180);
        const raio   = 4 + exploStep * 0.6;
        acao.moverPara(
            STATE.posicao.x + Math.cos(angulo) * raio,
            STATE.posicao.y,
            STATE.posicao.z + Math.sin(angulo) * raio
        );
        exploStep++;
    }, 2500);
}

// ============================================================================
// SEÇÃO 8 — GUARDA AUTÔNOMA E ANTI-AFK
// ============================================================================
function tickGuarda() {
    if (!STATE.modoGuarda || STATE.emCombate) return;
    const alvoId = entidadeMaisProxima(e =>
        LISTA.hostis.includes(e.name) &&
        distancia(STATE.posicao, e.position) <= CONFIG.combate.guardaRaioBlk
    );
    if (alvoId) {
        log.pvp(`[GUARDA] Mob: ${STATE.entities.get(alvoId).name}. Atacando.`);
        iniciarCombate(alvoId);
    }
}

function antiAfk() {
    if (Date.now() - STATE.ultimoMovimento < CONFIG.antiAfk.intervaloMs || STATE.emCombate) return;
    const o = (Math.random() - 0.5) * 0.3;
    acao.moverPara(STATE.posicao.x + o, STATE.posicao.y, STATE.posicao.z + o);
    log.info('Anti-AFK: micro-movimento.');
}

// ============================================================================
// SEÇÃO 9 — ROTEADOR DE COMANDOS DE CHAT
// ============================================================================
const PREFIXO = '!';
const MSG_AJUDA = [
    '§e======= MINEBOT_SSJ3 v2.1 =======',
    '§a!status§r       HP, fome e posição',
    '§a!atacar <nome>§r Atacar jogador',
    '§a!mobs§r         Mob hostil mais próximo',
    '§a!parar§r        Parar tudo',
    '§a!vem§r          Seguir você',
    '§a!para§r         Parar de seguir',
    '§a!explorar§r     Exploração autônoma',
    '§a!ir <x> <y> <z>§r Ir para coords',
    '§a!tp <nome>§r    Ir até jogador',
    '§a!inventario§r   Listar itens',
    '§a!comer§r        Forçar comer',
    '§a!arma§r         Equipar melhor arma',
    '§a!guardar on|off§r Modo guarda',
    '§a!jogadores§r    Listar online',
    '§a!ping§r         Testar resposta',
    '§e================================='
].join('\n');

function processarComando(username, message) {
    if (username === CONFIG.username || !message.startsWith(PREFIXO)) return;
    const partes = message.slice(PREFIXO.length).trim().split(/ +/);
    const cmd    = partes.shift().toLowerCase();
    const args   = partes;
    log.info(`[CMD] ${username}: !${cmd} ${args.join(' ')}`);

    switch (cmd) {
        case 'status':
            log.status();
            acao.chat(`HP: ${STATE.health}/${STATE.maxHealth} | Fome: ${STATE.food} | ${posStr()}`);
            break;

        case 'atacar': {
            if (!args[0]) { acao.chat('Uso: !atacar <nome>'); break; }
            const p = STATE.players.get(args[0]);
            if (!p || !STATE.entities.has(p.runtimeId)) { acao.chat(`"${args[0]}" não visível.`); break; }
            acao.chat(`Atacando ${args[0]}!`);
            iniciarCombate(p.runtimeId);
            break;
        }

        case 'mobs': {
            const id = entidadeMaisProxima(e => LISTA.hostis.includes(e.name));
            if (!id) { acao.chat('Nenhum mob hostil visível.'); break; }
            acao.chat(`Atacando ${STATE.entities.get(id).name}!`);
            iniciarCombate(id);
            break;
        }

        case 'parar':
            pararCombate(); pararMovimento();
            acao.chat('Parado. Modo pacífico.');
            break;

        case 'vem':
            seguirJogador(username);
            acao.chat(`Seguindo ${username}.`);
            break;

        case 'para':
            pararMovimento();
            acao.chat('Movimento parado.');
            break;

        case 'explorar':
            explorar();
            acao.chat('Exploração iniciada!');
            break;

        case 'ir': {
            if (args.length < 3) { acao.chat('Uso: !ir <x> <y> <z>'); break; }
            const [gx, gy, gz] = args.map(Number);
            if ([gx, gy, gz].some(isNaN)) { acao.chat('Coordenadas inválidas.'); break; }
            pararMovimento();
            acao.moverPara(gx, gy, gz);
            acao.chat(`Indo para (${gx}, ${gy}, ${gz}).`);
            break;
        }

        case 'tp': {
            if (!args[0]) { acao.chat('Uso: !tp <nome>'); break; }
            const p = STATE.players.get(args[0]);
            if (!p || !STATE.entities.has(p.runtimeId)) { acao.chat(`${args[0]} não encontrado.`); break; }
            const e = STATE.entities.get(p.runtimeId);
            acao.moverPara(e.position.x, e.position.y, e.position.z);
            acao.chat(`Teleportando para ${args[0]}.`);
            break;
        }

        case 'inventario': {
            const itens = [...STATE.inventory.values()].filter(Boolean).map(i => `${i.name}x${i.count}`).join(', ');
            acao.chat(itens ? `Inv: ${itens}` : 'Inventário vazio.');
            break;
        }

        case 'comer': autoEat(); break;

        case 'arma':
            if (!equiparMelhorArma()) acao.chat('Nenhuma arma encontrada.');
            break;

        case 'guardar':
            if (args[0] === 'on')        { STATE.modoGuarda = true;  acao.chat('Guarda: §aON'); }
            else if (args[0] === 'off')  { STATE.modoGuarda = false; acao.chat('Guarda: §cOFF'); }
            else acao.chat(`Guarda: ${STATE.modoGuarda ? '§aON' : '§cOFF'}. Use on|off`);
            break;

        case 'jogadores': {
            const lista = [...STATE.players.keys()].filter(n => n !== CONFIG.username).join(', ');
            acao.chat(lista ? `Online: ${lista}` : 'Nenhum jogador visível.');
            break;
        }

        case 'ping':
            acao.chat(`Pong! v2.1 operacional. HP: ${STATE.health}`);
            break;

        case 'ajuda':
            acao.chat(MSG_AJUDA);
            break;

        default:
            acao.chat(`Comando desconhecido: !${cmd}. Use !ajuda`);
    }
}

// ============================================================================
// SEÇÃO 10 — HANDLERS DE PACKETS
// ============================================================================
function inicializarModulos(client) {
    log.ok('Inicializando handlers de packets...');

    client.on('text', (pkt) => {
        if (pkt.type === 'chat' || pkt.type === 'announcement') {
            const username = pkt.source_name || '';
            const message  = pkt.message     || '';
            if (message) log.info(`[Chat] ${username}: ${message}`);
            processarComando(username, message);
        }
    });

    client.on('correct_player_move_prediction', (pkt) => {
        if (pkt.position) STATE.posicao = { x: pkt.position.x, y: pkt.position.y - 1.62, z: pkt.position.z };
    });

    client.on('move_player', (pkt) => {
        if (pkt.runtime_id === STATE.runtimeId) {
            STATE.posicao  = { x: pkt.position.x, y: pkt.position.y - 1.62, z: pkt.position.z };
            STATE.onGround = pkt.on_ground;
        }
    });

    client.on('add_player', (pkt) => {
        const isBot = pkt.username === CONFIG.username;
        if (isBot && STATE.runtimeId === BigInt(0)) {
            STATE.runtimeId = pkt.runtime_id;
            log.ok(`Runtime ID do bot: ${STATE.runtimeId}`);
        }
        STATE.entities.set(pkt.runtime_id, {
            runtimeId: pkt.runtime_id, username: pkt.username,
            name: pkt.username, position: pkt.position || { x: 0, y: 64, z: 0 }, type: 'player'
        });
        STATE.players.set(pkt.username, { runtimeId: pkt.runtime_id, username: pkt.username });
        if (!isBot) log.info(`Jogador entrou: ${pkt.username}`);
    });

    client.on('add_entity', (pkt) => {
        const nome = (pkt.entity_type || 'unknown').replace('minecraft:', '');
        STATE.entities.set(pkt.runtime_entity_id, {
            runtimeId: pkt.runtime_entity_id, name: nome,
            position: pkt.position || { x: 0, y: 64, z: 0 },
            velocity: pkt.velocity || { x: 0, y: 0, z: 0 }, type: 'mob'
        });
    });

    client.on('remove_entity', (pkt) => {
        const e = STATE.entities.get(pkt.entity_id_self);
        if (e?.type === 'player') STATE.players.delete(e.username);
        STATE.entities.delete(pkt.entity_id_self);
        if (STATE.alvoAtual === pkt.entity_id_self) { log.ok('Alvo removido.'); pararCombate(); }
    });

    client.on('move_entity', (pkt) => {
        const e = STATE.entities.get(pkt.runtime_entity_id);
        if (e && pkt.position) e.position = pkt.position;
    });

    client.on('move_entity_delta', (pkt) => {
        const e = STATE.entities.get(pkt.runtime_entity_id);
        if (!e) return;
        if (pkt.flags & 0x01) e.position.x += pkt.x || 0;
        if (pkt.flags & 0x02) e.position.y += pkt.y || 0;
        if (pkt.flags & 0x04) e.position.z += pkt.z || 0;
    });

    client.on('update_attributes', (pkt) => {
        if (pkt.runtime_entity_id !== STATE.runtimeId) return;
        for (const attr of (pkt.attributes || [])) {
            if (attr.name === 'minecraft:health') {
                STATE.health = attr.current; STATE.maxHealth = attr.max;
                if (STATE.health <= 0) {
                    log.erro('Bot morreu! Respawnando em 2.5s...');
                    pararCombate(); pararMovimento();
                    setTimeout(() => acao.respawn(), 2500);
                }
                checkSaude();
            }
            if (attr.name === 'minecraft:player.hunger') {
                STATE.food = attr.current;
                if (STATE.food <= 14) autoEat();
            }
        }
    });

    client.on('inventory_content', (pkt) => {
        STATE.inventory.clear();
        (pkt.input || []).forEach((item, slot) => {
            if (item && item.network_id !== 0) STATE.inventory.set(slot, item);
        });
        log.ok(`Inventário: ${STATE.inventory.size} item(s).`);
    });

    client.on('inventory_slot', (pkt) => {
        if (pkt.item && pkt.item.network_id !== 0) STATE.inventory.set(pkt.slot, pkt.item);
        else STATE.inventory.delete(pkt.slot);
    });

    client.on('hurt_animation', (pkt) => {
        if (pkt.entity_id !== STATE.runtimeId || STATE.emCombate || !STATE.modoGuarda) return;
        const id = entidadeMaisProxima(e => e.runtimeId !== STATE.runtimeId && distancia(STATE.posicao, e.position) < 5);
        if (id) {
            const ag = STATE.entities.get(id);
            log.pvp(`Atacado! Revidando → ${ag?.name || ag?.username || '?'}`);
            iniciarCombate(id);
        }
    });

    client.on('death_info', () => {
        log.erro('Evento de morte.'); pararCombate(); pararMovimento();
    });

    setInterval(() => { log.status(); tickGuarda(); antiAfk(); }, 10_000);

    log.ok('Todos os módulos online. Bot operacional!');
    acao.chat('§aMinebot_SSJ3 v2.1 §ronline! §7Use §f!ajuda §7para comandos.');
}

// ============================================================================
// SEÇÃO 11 — GERENCIADOR DE CONEXÃO COM AUTO-RECONEXÃO
// ============================================================================
function tentarReconectar() {
    STATE.reconexaoTentativas++;
    if (STATE.reconexaoTentativas > CONFIG.reconexao.maxTentativas) {
        log.erro('Máximo de tentativas atingido. Encerrando.'); process.exit(1);
    }
    log.aviso(`Reconectando em ${CONFIG.reconexao.intervaloMs / 1000}s... (${STATE.reconexaoTentativas}/${CONFIG.reconexao.maxTentativas})`);
    setTimeout(forjarConexao, CONFIG.reconexao.intervaloMs);
}

function forjarConexao() {
    log.info(`Conectando → ${CONFIG.host}:${CONFIG.port} | User: ${CONFIG.username} | Version: ${CONFIG.version ?? 'auto'}`);
    let client;
    try {
        client = bedrock.createClient(CONFIG);
    } catch (err) {
        log.erro(`Falha ao criar cliente: ${err.message}`);
        tentarReconectar(); return;
    }
    STATE.client = client;

    client.on('spawn', () => {
        STATE.reconexaoTentativas = 0;
        log.ok('Spawn confirmado! Inicializando módulos...');
        inicializarModulos(client);
    });

    client.on('error', (err) => log.erro(`Erro de socket: ${err.message}`));

    client.on('close', () => {
        log.aviso('Conexão encerrada.');
        pararCombate(); pararMovimento(); tentarReconectar();
    });

    client.on('kick', (reason) => {
        log.erro(`Kick: ${JSON.stringify(reason)}`);
        if (reason?.reason === 'outdated_client') {
            log.erro('╔═══════════════════════════════════════════════════╗');
            log.erro('║  bedrock-protocol não suporta esta versão ainda.  ║');
            log.erro('║  Solução: npm install github:PrismarineJS/         ║');
            log.erro('║           bedrock-protocol                        ║');
            log.erro('╚═══════════════════════════════════════════════════╝');
        }
        pararCombate(); pararMovimento(); tentarReconectar();
    });
}

// ============================================================================
// SEÇÃO 12 — ENTRADA
// ============================================================================
console.log(chalk.bold.green('╔══════════════════════════════════════╗'));
console.log(chalk.bold.green('║   MINEBOT_SSJ3 — BEDROCK CORE v2.1  ║'));
console.log(chalk.bold.green('║   Node.js + bedrock-protocol/RakNet  ║'));
console.log(chalk.bold.green('║   BDS 1.26.x + Celular LAN           ║'));
console.log(chalk.bold.green('╚══════════════════════════════════════╝'));
log.info(`BDS     : ${CONFIG.host}:${CONFIG.port}`);
log.info(`Usuário : ${CONFIG.username}`);
log.info(`Versão  : ${CONFIG.version ?? 'auto-detect'}`);
log.info(`Offline : ${CONFIG.offline}`);
console.log('');
forjarConexao();
