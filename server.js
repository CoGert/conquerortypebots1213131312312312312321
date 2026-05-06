// server.js (Enhanced for Leader/Follower)
const WebSocket = require('ws');
const msgpack = require('msgpack-lite');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Filter out unwanted console messages
const originalConsoleLog = console.log;
console.log = function(...args) {
    const message = args.join(' ');
    
    // Filter out messages containing "Client"
    if (message.includes('Client')) {
        return; // Silently filter out client messages
    }
    
    return originalConsoleLog.apply(console, args);
};

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const EXPECTED_LEADER_TOKEN = 'follow-3c8f2e'; // Token for the leader client

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
                res.end('OK');
                return;
            }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('OK');
});

const wss = new WebSocket.Server({ server });

// Store active leaders. Key: activeFollowName, Value: { ws, id (leader's clientID), x, y, mouseX, mouseY, clientX, clientY, viewportWidth, viewportHeight, gdScale, mouseWorldX, mouseWorldY, isSpecialAction, lastUpdate, followers: Set<WebSocket> }
const activeLeaders = new Map();
// Store follower clients directly, perhaps mapping them to the leader they are following
// Key: follower WebSocket, Value: leaderName string
const followerSubscriptions = new Map();

let nextClientId = 1;

server.listen(PORT, HOST, () => {
    console.log(`WebSocket server (Leader/Follower) listening on ${HOST}:${PORT}`);
});

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        process.exit(0);
    }
    throw err;
});

wss.on('connection', (ws, req) => {
    const clientId = nextClientId++;
    const clientIp = req.socket.remoteAddress;
    // console.log(`[Client ${clientId} - ${clientIp}] Connected.`); // Commented to reduce spam

    ws.on('message', (message) => {
        try {
            const dataArray = (message instanceof Buffer) ? new Uint8Array(message) : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
            let decodedData = msgpack.decode(dataArray);

            if (!decodedData || !Array.isArray(decodedData) || decodedData.length === 0) {
                console.warn(`[Client ${clientId}] Received empty/invalid msgpack.`);
                return;
            }
            const type = decodedData.splice(0, 1)[0];

            switch (type) {
                // --- Leader Messages ---
                case 0: // Leader Initialization: [token, clientType (2 for leader)]
                    if (decodedData.length >= 2) {
                        const [token, clientTypeCode] = decodedData;
                        if (token === EXPECTED_LEADER_TOKEN && clientTypeCode === 2) {
                            // console.log(`[Client ${clientId}] Registered as a LEADER.`); // Commented to reduce spam
                            // Store this client's ws temporarily until they send their first type 1 update with their name
                            ws.isLeaderCandidate = true;
                            ws.leaderClientId = clientId;
                            ws.send(msgpack.encode([0, 0])); // Ack
                        } else {
                            console.warn(`[Client ${clientId}] Invalid leader init. Token: ${token}, TypeCode: ${clientTypeCode}. Terminating.`);
                            ws.terminate();
                        }
                    } else { ws.terminate(); }
                    break;

                case 1: // Leader Update: [worldX, worldY, activeFollowName, mouseX, mouseY, specialAction, clientX, clientY, viewportWidth, viewportHeight, gdScale, mouseWorldX, mouseWorldY]
                    if (ws.isLeaderCandidate && decodedData.length >= 6) {
                        const [
                            worldX,
                            worldY,
                            activeFollowName,
                            mouseX,
                            mouseY,
                            specialAction,
                            clientX = null,
                            clientY = null,
                            viewportWidth = null,
                            viewportHeight = null,
                            gdScale = null,
                            mouseWorldX = null,
                            mouseWorldY = null
                        ] = decodedData;

                        let leaderData = activeLeaders.get(activeFollowName);
                        if (!leaderData) { // First update from this leader, or name changed
                            leaderData = { followers: new Set() }; // Initialize followers set
                            activeLeaders.set(activeFollowName, leaderData);
                            // console.log(`[Leader: ${activeFollowName} (Client ${clientId})] Now ACTIVE.`); // Commented to reduce spam
                        }
                        // Update leader data
                        leaderData.ws = ws;
                        leaderData.id = clientId; // Ensure client ID is associated
                        leaderData.name = activeFollowName;
                        leaderData.x = worldX;
                        leaderData.y = worldY;
                        leaderData.mouseX = mouseX;
                        leaderData.mouseY = mouseY;
                        leaderData.clientX = clientX;
                        leaderData.clientY = clientY;
                        leaderData.viewportWidth = viewportWidth;
                        leaderData.viewportHeight = viewportHeight;
                        leaderData.gdScale = gdScale;
                        leaderData.mouseWorldX = mouseWorldX;
                        leaderData.mouseWorldY = mouseWorldY;
                        leaderData.isSpecialAction = specialAction;
                        leaderData.lastUpdate = Date.now();

                        // console.log(`[Leader: ${activeFollowName}] Update: Pos(${worldX},${worldY})`); // Commented to reduce spam

                        // Broadcast to this leader's followers
                        broadcastToFollowers(activeFollowName, leaderData);
                    } else if (!ws.isLeaderCandidate) {
                        console.warn(`[Client ${clientId}] Sent type 1 update but not registered as leader candidate.`);
                    } else { console.warn(`[Client ${clientId}] Malformed type 1 message.`); }
                    break;

                case 3: // Leader Deactivate: [activeFollowName]
                    if (decodedData.length >= 1) {
                        const [activeFollowName] = decodedData;
                        const leaderData = activeLeaders.get(activeFollowName);
                        if (leaderData && leaderData.ws === ws) {
                            notifyFollowersLeaderInactive(activeFollowName, leaderData.followers);
                            activeLeaders.delete(activeFollowName);
                            console.log(`[Leader: ${activeFollowName} (Client ${clientId})] Deactivated and removed.`);
                        }
                    } else { console.warn(`[Client ${clientId}] Malformed type 3 message.`); }
                    break;

                // --- Follower Messages ---
                case 10: // Follower Subscribe: [leaderName_to_follow]
                    if (decodedData.length >= 1) {
                        const leaderNameToFollow = decodedData[0];
                        if (activeLeaders.has(leaderNameToFollow)) {
                            const leaderData = activeLeaders.get(leaderNameToFollow);
                            leaderData.followers.add(ws); // Add this follower's WebSocket to the leader's set
                            followerSubscriptions.set(ws, leaderNameToFollow); // Track who this ws is following
                            ws.isFollower = true;
                            ws.followingLeaderName = leaderNameToFollow;
                            // console.log(`[Client ${clientId}] Now following Leader: ${leaderNameToFollow}. Total followers for ${leaderNameToFollow}: ${leaderData.followers.size}`); // Commented to reduce spam
                            // Send current leader state to the new follower
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(msgpack.encode([
                                    101,
                                    leaderData.x,
                                    leaderData.y,
                                    leaderData.mouseX,
                                    leaderData.mouseY,
                                    leaderData.isSpecialAction,
                                    leaderData.clientX,
                                    leaderData.clientY,
                                    leaderData.viewportWidth,
                                    leaderData.viewportHeight,
                                    leaderData.gdScale,
                                    leaderData.mouseWorldX,
                                    leaderData.mouseWorldY
                                ]));
                            }
                        } else {
                            console.warn(`[Client ${clientId}] Tried to follow non-existent Leader: ${leaderNameToFollow}`);
                            if (ws.readyState === WebSocket.OPEN) ws.send(msgpack.encode([103, `Leader ${leaderNameToFollow} not found`])); // Error type 103
                        }
                    } else { console.warn(`[Client ${clientId}] Malformed type 10 (Follower Subscribe) message.`);}
                    break;

                default:
                    console.log(`[Client ${clientId}] Unhandled type ${type}, Data:`, decodedData);
                    break;
            }
        } catch (e) {
            console.error(`[Client ${clientId}] Error processing message:`, e);
        }
    });

    ws.on('close', () => {
        console.log(`[Client ${clientId} - ${clientIp}] Disconnected.`);
        // If it was a leader
        if (ws.isLeaderCandidate) {
            for (const [name, leaderData] of activeLeaders.entries()) {
                if (leaderData.ws === ws) {
                    notifyFollowersLeaderInactive(name, leaderData.followers);
                    activeLeaders.delete(name);
                    console.log(`[Leader: ${name} (Client ${clientId})] Abrupt disconnect. Removed.`);
                    break;
                }
            }
        }
        // If it was a follower
        if (ws.isFollower && followerSubscriptions.has(ws)) {
            const leaderName = followerSubscriptions.get(ws);
            const leaderData = activeLeaders.get(leaderName);
            if (leaderData && leaderData.followers) {
                leaderData.followers.delete(ws);
                console.log(`[Follower Client ${clientId}] Unsubscribed from ${leaderName} due to disconnect. Remaining followers for ${leaderName}: ${leaderData.followers.size}`);
            }
            followerSubscriptions.delete(ws);
        }
    });
    ws.on('error', (error) => { console.error(`[Client ${clientId}] WS error:`, error); });
});

function broadcastToFollowers(leaderName, leaderData) {
    if (leaderData.followers && leaderData.followers.size > 0) {
        const messageToFollower = msgpack.encode([
            101, // Type: Leader Update for Follower
            leaderData.x, leaderData.y,
            leaderData.mouseX, leaderData.mouseY,
            leaderData.isSpecialAction,
            leaderData.clientX,
            leaderData.clientY,
            leaderData.viewportWidth,
            leaderData.viewportHeight,
            leaderData.gdScale,
            leaderData.mouseWorldX,
            leaderData.mouseWorldY
        ]);
        leaderData.followers.forEach(followerWs => {
            if (followerWs.readyState === WebSocket.OPEN) {
                try {
                    followerWs.send(messageToFollower);
                } catch (e) {
                    console.error("Error sending update to follower:", e);
                }
            }
        });
    }
}

function notifyFollowersLeaderInactive(leaderName, followersSet) {
    if (followersSet && followersSet.size > 0) {
        console.log(`Notifying ${followersSet.size} followers that leader ${leaderName} is inactive.`);
        const messageToFollower = msgpack.encode([102, leaderName]); // Type: Leader Inactive
        followersSet.forEach(followerWs => {
            if (followerWs.readyState === WebSocket.OPEN) {
                try {
                    followerWs.send(messageToFollower);
                } catch (e) {
                    console.error("Error sending inactive notification to follower:", e);
                }
            }
        });
    }
}

// Stale leader cleanup (optional but good practice)
setInterval(() => {
    const now = Date.now();
    const STALE_TIMEOUT = 30000; // 30 seconds
    for (const [name, leaderData] of activeLeaders.entries()) {
        if (now - leaderData.lastUpdate > STALE_TIMEOUT) {
            console.log(`[Leader: ${name} (Client ${leaderData.id})] Stale, terminating and removing.`);
            if (leaderData.ws.readyState === WebSocket.OPEN || leaderData.ws.readyState === WebSocket.CONNECTING) {
                leaderData.ws.terminate(); // This will trigger its 'close' handler for proper cleanup
            } else { // If already closed but somehow still in map
                notifyFollowersLeaderInactive(name, leaderData.followers);
                activeLeaders.delete(name);
            }
        }
    }
}, 15000);
