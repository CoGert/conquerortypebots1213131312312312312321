// ==UserScript==
// @name         Follow Me arras.io (Server Name as Squad ID)
// @namespace    http://tampermonkey.net/
// @version      1.0.6_follow_sync_fix
// @description  Leader script. Uses a manual input for Squad ID.
// @author       Damocles, CX & You
// @match        https://arras.io/
// @match        http://arras.io/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=arras.io
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
    const LOG_PREFIX = '[FollowMe_ServerNameSquad]';
    const FOLLOW_SERVER_TOKEN = 'follow-3c8f2e';
    const FOLLOW_SERVER_WS_URL_DEFAULT = 'ws://localhost:8080';
    const FOLLOW_SERVER_WS_STORAGE_KEY = 'follow_server_ws_url';
    const MOUSE_SCALE_STORAGE_KEY = 'follow_mouse_scale';
    const MOUSE_OFFSET_X_STORAGE_KEY = 'follow_mouse_offset_x';
    const MOUSE_OFFSET_Y_STORAGE_KEY = 'follow_mouse_offset_y';

    // --- UI Elements & State ---
    let uiPanel, uiCheckboxFollow, uiCheckboxAction, uiCheckboxPause,
        uiSpawnStatus, uiCoordsStatus, uiFollowWsStatus, uiGdStatus, uiGameHostStatus, uiBroadcastingNameStatus,
        uiSquadNameInput, uiFollowWsInput,
        uiMouseScaleInput, uiMouseOffsetXInput, uiMouseOffsetYInput; // Calibration inputs

    let position = [0, 0, 0]; // [worldX, worldY, lastUpdateTimeMs]
    let displayCoords = { x: null, y: null };
    let hasSpawned = false;
    let gameActualKeydownHandler = null;
    let firstSpawnLKeyPressDone = false;
    let followSocket = null;
    let followSocketConnected = false;
    // lastSentData stores [sentWorldX, sentWorldY, sentMouseX, sentMouseY, sentActionState, sentClientX, sentClientY]
    let lastSentData = [null, null, 0, 0, false, 0, 0]; // Initialize to a state that will trigger first send
    let mouseGameCoords = [0, 0]; // [mouseX, mouseY] for sending (scaled by gd*10)
    let mouseScreenCoords = {
        x: window.innerWidth * 0.5,
        y: window.innerHeight * 0.5
    };
    let gd = 0;
    let lastKnownGd = 0;
    let gameServerHost = 'N/A';
    let currentArrasStatusObjects = {};
    let activeFollowName = null;
    let isBroadcastingPaused = false;
    let mouseOutOfViewport = false;
    let lastOutOfViewportSendTime = 0;
    const OUT_OF_VIEW_SEND_INTERVAL_MS = 250;
    let cursorDot = null;
    let mouseScale = 1;
    let mouseOffsetX = 0;
    let mouseOffsetY = 0;

    function createUIPanel() {
        if (document.getElementById('followme-sns-panel')) return;
        uiPanel = document.createElement('div');
        uiPanel.id = 'followme-sns-panel';
        Object.assign(uiPanel.style, {
            position: 'fixed', top: '10px', right: '10px', width: '240px',
            background: 'rgba(0, 0, 0, 0.8)', color: 'white', fontFamily: 'Arial, sans-serif',
            fontSize: '12px', padding: '10px', borderRadius: '5px', border: '1px solid #444',
            zIndex: '10001', userSelect: 'none'
        });
        // MODIFIED: Added a manual input field for the squad ID.
        const storedFollowWsUrl = localStorage.getItem(FOLLOW_SERVER_WS_STORAGE_KEY) || FOLLOW_SERVER_WS_URL_DEFAULT;
        const storedMouseScale = parseFloat(localStorage.getItem(MOUSE_SCALE_STORAGE_KEY));
        const storedMouseOffsetX = parseFloat(localStorage.getItem(MOUSE_OFFSET_X_STORAGE_KEY));
        const storedMouseOffsetY = parseFloat(localStorage.getItem(MOUSE_OFFSET_Y_STORAGE_KEY));
        mouseScale = Number.isFinite(storedMouseScale) && storedMouseScale > 0 ? storedMouseScale : 1;
        mouseOffsetX = Number.isFinite(storedMouseOffsetX) ? storedMouseOffsetX : 0;
        mouseOffsetY = Number.isFinite(storedMouseOffsetY) ? storedMouseOffsetY : 0;
        let htmlContent = `
            <h3 style="margin-top:0; margin-bottom:8px; text-align:center; font-size:14px;">FollowMe Control (Server Squad)</h3>
            <div style="margin-bottom:5px;">
                <label for="fm-sns-squad-name" style="display:block; margin-bottom:3px;">Broadcasting As (Squad ID):</label>
                <input type="text" id="fm-sns-squad-name" placeholder="Enter Squad ID here" style="width: 95%; background: #333; color: white; border: 1px solid #555; padding: 3px;">
            </div>
            <div style="margin-bottom:8px;">
                <label for="fm-sns-follow-url" style="display:block; margin-bottom:3px;">Follow Server WS URL:</label>
                <input type="text" id="fm-sns-follow-url" placeholder="wss://your-space.hf.space" value="${storedFollowWsUrl}" style="width: 95%; background: #333; color: white; border: 1px solid #555; padding: 3px;">
            </div>
            <div style="margin-bottom:5px;">
                <input type="checkbox" id="fm-sns-chkbx-follow" style="vertical-align:middle; accent-color:rgb(255,155,0);">
                <label for="fm-sns-chkbx-follow" style="vertical-align:middle;">Enable Follow (F)</label>
            </div>
            <div style="margin-bottom:5px;">
                <input type="checkbox" id="fm-sns-chkbx-pause" style="vertical-align:middle; accent-color:rgb(0,155,255);">
                <label for="fm-sns-chkbx-pause" style="vertical-align:middle;">Pause Broadcast (P)</label>
            </div>
            <div style="margin-bottom:8px;">
                <input type="checkbox" id="fm-sns-chkbx-action" style="vertical-align:middle; accent-color:rgb(255,155,0);">
                <label for="fm-sns-chkbx-action" style="vertical-align:middle;">Alt Action (RMB)</label>
            </div>
            <div style="margin-bottom:6px;">
                <label style="display:block; margin-bottom:3px;">Mouse Cal (scale / offX / offY)</label>
                <div style="display:flex; gap:4px;">
                    <input type="text" id="fm-sns-mouse-scale" value="${mouseScale.toFixed(2)}" style="width: 33%; background: #333; color: white; border: 1px solid #555; padding: 3px;" title="Scale multiplier">
                    <input type="text" id="fm-sns-mouse-offx" value="${mouseOffsetX}" style="width: 33%; background: #333; color: white; border: 1px solid #555; padding: 3px;" title="World offset X">
                    <input type="text" id="fm-sns-mouse-offy" value="${mouseOffsetY}" style="width: 33%; background: #333; color: white; border: 1px solid #555; padding: 3px;" title="World offset Y">
                </div>
            </div>
            <p id="fm-sns-spawn-status" style="margin:3px 0;">Spawned: Waiting...</p>
            <p id="fm-sns-coords-status" style="margin:3px 0;">Coords: Waiting...</p>
            <p id="fm-sns-follow-ws-status" style="margin:3px 0;">Follow WS: Disconnected</p>
            <p id="fm-sns-gd-status" style="margin:3px 0;">GD Scale: Calculating...</p>
        `;
        uiPanel.innerHTML = htmlContent;
        if (document.body) document.body.appendChild(uiPanel);
        else window.addEventListener('DOMContentLoaded', () => document.body.appendChild(uiPanel));

        uiSquadNameInput = document.getElementById('fm-sns-squad-name'); // ADDED
        uiFollowWsInput = document.getElementById('fm-sns-follow-url');
        uiCheckboxFollow = document.getElementById('fm-sns-chkbx-follow');
        uiCheckboxPause = document.getElementById('fm-sns-chkbx-pause');
        uiCheckboxAction = document.getElementById('fm-sns-chkbx-action');
        uiMouseScaleInput = document.getElementById('fm-sns-mouse-scale');
        uiMouseOffsetXInput = document.getElementById('fm-sns-mouse-offx');
        uiMouseOffsetYInput = document.getElementById('fm-sns-mouse-offy');
        uiSpawnStatus = document.getElementById('fm-sns-spawn-status');
        uiCoordsStatus = document.getElementById('fm-sns-coords-status');
        uiFollowWsStatus = document.getElementById('fm-sns-follow-ws-status');
        uiGdStatus = document.getElementById('fm-sns-gd-status');
        if (uiFollowWsInput && !uiFollowWsInput.dataset.bound) {
            uiFollowWsInput.addEventListener('input', () => {
                const value = uiFollowWsInput.value.trim();
                if (value) {
                    localStorage.setItem(FOLLOW_SERVER_WS_STORAGE_KEY, value);
                }
            });
            uiFollowWsInput.dataset.bound = '1';
        }

        if (uiMouseScaleInput) {
            uiMouseScaleInput.addEventListener('input', () => {
                const next = parseFloat(uiMouseScaleInput.value);
                if (Number.isFinite(next) && next > 0) {
                    mouseScale = next;
                    localStorage.setItem(MOUSE_SCALE_STORAGE_KEY, String(mouseScale));
                }
            });
        }
        if (uiMouseOffsetXInput) {
            uiMouseOffsetXInput.addEventListener('input', () => {
                const next = parseFloat(uiMouseOffsetXInput.value);
                if (Number.isFinite(next)) {
                    mouseOffsetX = next;
                    localStorage.setItem(MOUSE_OFFSET_X_STORAGE_KEY, String(mouseOffsetX));
                }
            });
        }
        if (uiMouseOffsetYInput) {
            uiMouseOffsetYInput.addEventListener('input', () => {
                const next = parseFloat(uiMouseOffsetYInput.value);
                if (Number.isFinite(next)) {
                    mouseOffsetY = next;
                    localStorage.setItem(MOUSE_OFFSET_Y_STORAGE_KEY, String(mouseOffsetY));
                }
            });
        }

        // Note: The original fields for auto-detection are gone from UI, but their variables are kept to prevent errors.
        uiGameHostStatus = null;
        uiBroadcastingNameStatus = null;

        uiCheckboxPause.disabled = !uiCheckboxFollow.checked;
        uiCheckboxAction.disabled = !uiCheckboxFollow.checked || isBroadcastingPaused;

        uiCheckboxFollow.addEventListener('input', handleFollowToggle);
        uiCheckboxPause.addEventListener('input', handlePauseToggle);

        window.addEventListener('keydown', (e) => {
            if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.code === 'KeyF') {
                uiCheckboxFollow.checked = !uiCheckboxFollow.checked;
                handleFollowToggle();
            } else if (e.code === 'KeyP' && !uiCheckboxPause.disabled) {
                uiCheckboxPause.checked = !uiCheckboxPause.checked;
                handlePauseToggle();
            }
        });
        window.addEventListener('mousedown', (e) => {
            if (e.button === 2 && uiCheckboxFollow.checked && !isBroadcastingPaused) {
                 uiCheckboxAction.checked = true;
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 2) {
                uiCheckboxAction.checked = false;
            }
        });
    }

    function ensureCursorDot() {
        if (cursorDot) return;
        cursorDot = document.createElement('div');
        cursorDot.id = 'followme-cursor-dot';
        Object.assign(cursorDot.style, {
            position: 'fixed',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#3aa0ff',
            boxShadow: '0 0 4px rgba(58, 160, 255, 0.9)',
            pointerEvents: 'none',
            zIndex: '10002',
            transform: 'translate(-50%, -50%)',
            left: '0px',
            top: '0px',
            opacity: '0.9'
        });
        if (document.body) {
            document.body.appendChild(cursorDot);
        } else {
            window.addEventListener('DOMContentLoaded', () => document.body.appendChild(cursorDot));
        }
    }

    function handleFollowToggle() {
        if (uiCheckboxFollow.checked) {
            uiCheckboxPause.disabled = false;
            if (uiCheckboxPause.checked || isBroadcastingPaused) {
                uiCheckboxPause.checked = false;
                isBroadcastingPaused = false;
            }
            // MODIFIED: The automatic name detection is no longer used.
            // We get the name from the input field instead.
            activeFollowName = uiSquadNameInput.value.trim();
            connectToFollowServer();
        } else {
            isBroadcastingPaused = false;
            uiCheckboxPause.checked = false;
            uiCheckboxPause.disabled = true;
            uiCheckboxAction.checked = false;
            uiCheckboxAction.disabled = true;

            if (activeFollowName && followSocketConnected) {
                sendToFollowServer([1, null, null, activeFollowName, 0, 0, false]);
                sendToFollowServer([3, activeFollowName]); // Send leader inactive
            }
        }
        uiCheckboxAction.disabled = !uiCheckboxFollow.checked || isBroadcastingPaused;
    }

    function sendCurrentState() {
        // This function is called to send the current, valid leader state.
        // Used when unpausing or to ensure the follower has the latest info.
        if (!uiCheckboxFollow || !uiCheckboxFollow.checked ||
            !followSocketConnected || !activeFollowName ||
            (position[0] === 0 && position[1] === 0 && displayCoords.x === null)) {
            // console.log(LOG_PREFIX, "Conditions not met to send current state.");
            return;
        }

        const mouseWorldCoords = updateMouseGameCoords();
        if (!mouseWorldCoords) {
            return;
        }

        const worldX = Math.round(position[0] * 10);
        const worldY = Math.round(position[1] * 10);
        const mouseX = mouseGameCoords[0];
        const mouseY = mouseGameCoords[1];
        const currentActionState = uiCheckboxAction.checked;
        const canvasRect = getCanvasRect();
        const withinViewport =
            mouseScreenCoords.x >= canvasRect.left &&
            mouseScreenCoords.x <= canvasRect.left + canvasRect.width &&
            mouseScreenCoords.y >= canvasRect.top &&
            mouseScreenCoords.y <= canvasRect.top + canvasRect.height;
        if (!withinViewport) {
            const now = performance.now();
            if (!mouseOutOfViewport || (now - lastOutOfViewportSendTime) >= OUT_OF_VIEW_SEND_INTERVAL_MS) {
                sendToFollowServer([1, null, null, activeFollowName, 0, 0, false, null, null, null, null, null, null]);
                lastOutOfViewportSendTime = now;
            }
            mouseOutOfViewport = true;
            return;
        }
        mouseOutOfViewport = false;
        const clientX = Math.round(mouseScreenCoords.x - canvasRect.left);
        const clientY = Math.round(mouseScreenCoords.y - canvasRect.top);
        const viewportWidth = Math.round(canvasRect.width);
        const viewportHeight = Math.round(canvasRect.height);
        const gdScale = gd;
        const mouseWorldX = mouseWorldCoords ? Math.round(mouseWorldCoords.x * 10) : worldX + mouseX;
        const mouseWorldY = mouseWorldCoords ? Math.round(mouseWorldCoords.y * 10) : worldY + mouseY;
        sendToFollowServer([1, worldX, worldY, activeFollowName, mouseX, mouseY, currentActionState, clientX, clientY, viewportWidth, viewportHeight, gdScale, mouseWorldX, mouseWorldY]);
        lastSentData = [worldX, worldY, mouseX, mouseY, currentActionState, clientX, clientY];
        lastSendTime = performance.now(); // Update last send time
    }


    let lastPauseSendTime = 0;
    const PAUSE_HEARTBEAT_MS = 1000;

    function sendPausedState() {
        if (!activeFollowName || !followSocketConnected) return;
        sendToFollowServer([1, null, null, activeFollowName, 0, 0, false, null, null, null, null, null, null]);
        lastPauseSendTime = performance.now();
    }

    function handlePauseToggle() {
        if (uiCheckboxPause.checked) {
            isBroadcastingPaused = true;
            if (uiCheckboxFollow.checked && followSocketConnected && activeFollowName) {
                sendPausedState();
                console.log(LOG_PREFIX, "Sent paused heartbeat packet to followers.");
                lastSentData = [null, null, 0, 0, false, 0, 0];
                lastSendTime = performance.now();
            }
            console.log(LOG_PREFIX, "Broadcasting Paused.");
        } else {
            isBroadcastingPaused = false;
            console.log(LOG_PREFIX, "Broadcasting Resumed.");
            // Immediately send the current state upon unpausing
            // This ensures the follower gets valid coordinates right away.
            sendCurrentState();
        }
        uiCheckboxAction.disabled = !uiCheckboxFollow.checked || isBroadcastingPaused;
    }


    function updateUIField(element, text, color = 'lime') {
        if (element) { element.textContent = text; element.style.color = color; }
    }

    function getCanvasRect() {
        if (ca && typeof ca.getBoundingClientRect === 'function') {
            const rect = ca.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
                return rect;
            }
        }

        return {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight
        };
    }

    function updateMouseGameCoords() {
        const effectiveGd = gd || lastKnownGd || 1;
        const rect = getCanvasRect();
        const w = rect.width || window.innerWidth;
        const h = rect.height || window.innerHeight;
        const viewportWidth = w || window.innerWidth || 1;
        const viewportHeight = h || window.innerHeight || 1;
        const gdAdjust = (window.innerWidth && viewportWidth)
            ? (window.innerWidth / viewportWidth)
            : 1;
        const normalizedGd = Math.abs(effectiveGd * gdAdjust);

        if (normalizedGd === 0 || viewportWidth === 0 || viewportHeight === 0) return null;

        const scale = (viewportWidth * 0.5625 > viewportHeight)
            ? 888.888888888 / viewportWidth
            : 500 / viewportHeight;
        const centeredX = mouseScreenCoords.x - rect.left - viewportWidth * 0.5;
        const centeredY = mouseScreenCoords.y - rect.top - viewportHeight * 0.5;

        // Convert screen delta to world delta (times 10 to stay consistent with worldX/Y scaling)
        const appliedScale = Number.isFinite(mouseScale) && mouseScale > 0 ? mouseScale : 1;
        mouseGameCoords[0] = Math.round(centeredX * scale * normalizedGd * 10 * appliedScale + mouseOffsetX * 10);
        mouseGameCoords[1] = Math.round(centeredY * scale * normalizedGd * 10 * appliedScale + mouseOffsetY * 10);
        return {
            x: position[0] + mouseGameCoords[0] / 10,
            y: position[1] + mouseGameCoords[1] / 10
        };
    }

    const msgpackScript = document.createElement('script');
    msgpackScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/msgpack-lite/0.1.26/msgpack.min.js';
    msgpackScript.onload = () => { console.log(LOG_PREFIX, 'msgpack-lite loaded.'); };
    document.documentElement.appendChild(msgpackScript);

    // --- Core functionality (Untouched from original) ---
    // All the original proxy methods for getting coordinates, spawn status,
    // and GD scale are preserved to ensure aiming and following work.

    try {
        const originalAddEventListener = window.EventTarget.prototype.addEventListener;
        window.EventTarget.prototype.addEventListener = new Proxy(originalAddEventListener, {
            apply: (target, thisArg, args) => {
                if (args[0] === 'keydown' && typeof args[1] === 'function' && !gameActualKeydownHandler &&
                    args[1].toString().includes(`.isTrusted`) && args[1].toString().includes(`return`)) {
                    gameActualKeydownHandler = args[1];
                    console.log(LOG_PREFIX, 'Game Keydown Handler Found.');
                }
                return Reflect.apply(target, thisArg, args);
            }
        });
    } catch (e) { console.error(LOG_PREFIX, 'Error proxying addEventListener for keydown:', e); }

    try {
        const originalFillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = new Proxy(originalFillText, {
            apply: (target, thisArg, args) => {
                const text = args[0];
                if (typeof text === 'string') {
                    if (text === 'You have spawned! Welcome to the game.') {
                        if (!hasSpawned) {
                            hasSpawned = true;
                            updateUIField(uiSpawnStatus, 'Spawned: YES');
                            console.log(LOG_PREFIX, 'Spawn Detected.');
                            if (gameActualKeydownHandler && !firstSpawnLKeyPressDone) {
                                console.log(LOG_PREFIX, "Simulating 'L' key press...");
                                try {
                                    gameActualKeydownHandler({
                                        isTrusted: true, key: 'l', code: 'KeyL', keyCode: 76, which: 76,
                                        preventDefault: () => {}, bubbles: true, cancelable: true, composed: true,
                                        target: thisArg.canvas || document.body
                                    });
                                    firstSpawnLKeyPressDone = true;
                                } catch (e) { console.error(LOG_PREFIX, "Error simulating 'L' key:", e); }
                            }
                        }
                    } else if (text.startsWith('Coordinates: (')) {
                        let coordsStr = text.slice(14);
                        let endIndex = coordsStr.indexOf(')');
                        if (endIndex !== -1) {
                            coordsStr = coordsStr.slice(0, endIndex);
                            const parts = coordsStr.split(', ');
                            if (parts.length === 2) {
                                const x = parseFloat(parts[0]);
                                const y = parseFloat(parts[1]);
                                if (!isNaN(x) && !isNaN(y)) {
                                    displayCoords.x = x; displayCoords.y = y;
                                    position[0] = x; position[1] = y; position[2] = performance.now() + 5000;
                                    updateUIField(uiCoordsStatus, `Coords: (${x.toFixed(1)}, ${y.toFixed(1)})`);
                                }
                            }
                        }
                    }
                }
                return Reflect.apply(target, thisArg, args);
            }
        });
    } catch (e) { console.error(LOG_PREFIX, 'Error proxying fillText:', e); }


    let st = 2, lx = 0, ca = {}, sr = 1, s_canvas_scale = 0;
    function calculateG() {
        let w = window.innerWidth; let h = window.innerHeight;
        if (ca.width) {
            if (w * 0.5625 > h) s_canvas_scale = 888.888888888 / w; else s_canvas_scale = 500 / h;
            sr = ca.width / w;
        }
    }
    try {
        const originalRAF = window.requestAnimationFrame;
        window.requestAnimationFrame = new Proxy(originalRAF, {
            apply: (t, ta, a) => {
                st = 2;
                calculateG();
                return Reflect.apply(t, ta, a);
            }
        });
        const originalMoveTo = CanvasRenderingContext2D.prototype.moveTo;
        CanvasRenderingContext2D.prototype.moveTo = new Proxy(originalMoveTo, {
            apply: (t, ta, a) => {
                ca = ta.canvas; calculateG();
                if (st > 0) {
                    st--;
                    if (st === 1) lx = a[0];
                    else if (st === 0 && (a[0] - lx !== 0) && sr !== 0) {
                        const new_gd = sr / (a[0] - lx);
                        if (isFinite(new_gd) && new_gd !== gd && Math.abs(new_gd) < 5 && Math.abs(new_gd) > 0.001) {
                            gd = Math.abs(new_gd);
                            lastKnownGd = gd;
                            updateUIField(uiGdStatus, `GD Scale: ${gd.toFixed(4)}`);
                            updateMouseGameCoords();
                        }
                    }
                }
                return Reflect.apply(t, ta, a);
            }
        });
    } catch (e) { console.error(LOG_PREFIX, 'Error proxying for GD Scale:', e); }

    window.addEventListener('mousemove', (e) => {
        mouseScreenCoords.x = e.clientX;
        mouseScreenCoords.y = e.clientY;
        ensureCursorDot();
        if (cursorDot) {
            cursorDot.style.left = `${mouseScreenCoords.x}px`;
            cursorDot.style.top = `${mouseScreenCoords.y}px`;
        }
        updateMouseGameCoords();
    }, true);

    window.addEventListener('wheel', () => {
        window.requestAnimationFrame(() => {
            updateMouseGameCoords();

            if (
                uiCheckboxFollow &&
                uiCheckboxFollow.checked &&
                !isBroadcastingPaused &&
                followSocketConnected &&
                activeFollowName
            ) {
                sendCurrentState();
            }
        });
    }, { capture: true, passive: true });

    function connectToFollowServer() {
        if (followSocket && (followSocket.readyState === WebSocket.OPEN || followSocket.readyState === WebSocket.CONNECTING)) return;
        if (!window.msgpack) {
            updateUIField(uiFollowWsStatus, 'Follow WS: msgpack N/A', 'orange'); return;
        }
        const followWsUrl = (uiFollowWsInput && uiFollowWsInput.value.trim())
            ? uiFollowWsInput.value.trim()
            : (localStorage.getItem(FOLLOW_SERVER_WS_STORAGE_KEY) || FOLLOW_SERVER_WS_URL_DEFAULT);
        if (!/^wss?:\/\//i.test(followWsUrl)) {
            updateUIField(uiFollowWsStatus, 'Follow WS: Invalid URL', 'red');
            return;
        }
        updateUIField(uiFollowWsStatus, 'Follow WS: Connecting...', 'yellow');
        followSocket = new WebSocket(followWsUrl);
        followSocket.binaryType = 'arraybuffer';
        followSocket.onopen = () => {
            followSocketConnected = true;
            updateUIField(uiFollowWsStatus, 'Follow WS: Connected');
            sendToFollowServer([0, FOLLOW_SERVER_TOKEN, 2]); // Type 2 for LEADER
            // Send initial state once connected if follow is enabled and not paused
            if (uiCheckboxFollow.checked && !isBroadcastingPaused) {
                sendCurrentState();
            }
        };
        followSocket.onmessage = (event) => {
            try {
                let data = window.msgpack.decode(new Uint8Array(event.data));
                if (!data || !Array.isArray(data)) return;
                const type = data.splice(0, 1)[0];
                if (type === 0 && data[0] === 0) console.log(LOG_PREFIX, 'Follow server ack host mode.');
            } catch (e) { console.error(LOG_PREFIX, 'Error processing msg from follow server:', e); }
        };
        followSocket.onclose = () => {
            followSocketConnected = false; followSocket = null;
            updateUIField(uiFollowWsStatus, 'Follow WS: Disconnected', 'red');
            if (uiCheckboxFollow && uiCheckboxFollow.checked) setTimeout(connectToFollowServer, 3000);
        };
        followSocket.onerror = (error) => {
            updateUIField(uiFollowWsStatus, 'Follow WS: Error', 'red');
            console.error(LOG_PREFIX, 'Follow server WS error:', error);
        };
    }

    function sendToFollowServer(payload) {
        if (followSocket && followSocket.readyState === WebSocket.OPEN && window.msgpack) {
            followSocket.send(window.msgpack.encode(payload));
        }
    }

    let lastSendTime = 0;
    setInterval(() => {
        if (!uiCheckboxFollow) createUIPanel();

        if (position[2] < performance.now() && displayCoords.x !== null && uiCoordsStatus) {
            updateUIField(uiCoordsStatus, `Coords: (${displayCoords.x.toFixed(1)}, ${displayCoords.y.toFixed(1)}) [STALE]`, 'orange');
        }

        if (uiCheckboxFollow && uiCheckboxFollow.checked && !followSocketConnected && (!followSocket || followSocket.readyState === WebSocket.CLOSED)) {
            connectToFollowServer();
        }

        if (!uiCheckboxFollow || !uiCheckboxFollow.checked) {
            return;
        }

        if (isBroadcastingPaused) {
            if (followSocketConnected && activeFollowName) {
                const now = performance.now();
                if (now - lastPauseSendTime >= PAUSE_HEARTBEAT_MS) {
                    sendPausedState();
                }
            }
            return;
        }

        // MODIFIED: Always get the latest squad ID from the input field before sending.
        // This is the critical change. The script now depends on this input.
        activeFollowName = uiSquadNameInput.value.trim();
        if (!activeFollowName) {
            // If the squad ID is empty, we cannot send data.
            return;
        }


        if (!followSocketConnected ||
            (position[0] === 0 && position[1] === 0 && displayCoords.x === null) ) {
            return;
        }

        sendCurrentState();
    }, 40);

    createUIPanel();
    console.log(LOG_PREFIX, 'Leader Script (v1.0.6_follow_sync_fix) Initialized.');
})();
