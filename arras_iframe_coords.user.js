// ==UserScript==
// @name         Arras.io 500x500 Iframe Mouse Coordinates
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  Shows arras.io inside a 500x500 iframe with cursor coordinates relative to the iframe.
// @author       You
// @match        https://arras.io/
// @match        http://arras.io/
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const FRAME_SIZE = 500;

  document.head.innerHTML = '';
  document.body.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = `
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #111;
      font-family: Arial, sans-serif;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `;
  document.head.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = `${FRAME_SIZE}px`;
  wrapper.style.height = `${FRAME_SIZE}px`;
  wrapper.style.border = '2px solid #444';
  wrapper.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
  wrapper.style.overflow = 'hidden';

  const frame = document.createElement('iframe');
  frame.src = 'https://arras.io/';
  frame.width = String(FRAME_SIZE);
  frame.height = String(FRAME_SIZE);
  frame.style.border = '0';
  frame.style.display = 'block';
  frame.style.overflow = 'hidden';
  frame.setAttribute('scrolling', 'no');

  const coordLabel = document.createElement('div');
  coordLabel.textContent = 'x: -, y: -';
  coordLabel.style.position = 'absolute';
  coordLabel.style.left = '8px';
  coordLabel.style.top = '8px';
  coordLabel.style.padding = '4px 8px';
  coordLabel.style.borderRadius = '4px';
  coordLabel.style.background = 'rgba(0, 0, 0, 0.7)';
  coordLabel.style.color = '#fff';
  coordLabel.style.fontSize = '12px';
  coordLabel.style.pointerEvents = 'none';
  coordLabel.style.zIndex = '10';

  const updateFromViewportPoint = (clientX, clientY) => {
    const rect = wrapper.getBoundingClientRect();
    const x = Math.round(clientX - rect.left);
    const y = Math.round(clientY - rect.top);
    if (x >= 0 && y >= 0 && x <= FRAME_SIZE && y <= FRAME_SIZE) {
      coordLabel.textContent = `x: ${x}, y: ${y}`;
    }
  };

  wrapper.addEventListener('mousemove', (event) => {
    updateFromViewportPoint(event.clientX, event.clientY);
  });

  wrapper.addEventListener('mouseleave', () => {
    coordLabel.textContent = 'x: -, y: -';
  });

  frame.addEventListener('load', () => {
    try {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) return;
      frameWindow.addEventListener('mousemove', (event) => {
        const rect = wrapper.getBoundingClientRect();
        const clientX = rect.left + event.clientX;
        const clientY = rect.top + event.clientY;
        updateFromViewportPoint(clientX, clientY);
      });
      frameWindow.addEventListener('mouseleave', () => {
        coordLabel.textContent = 'x: -, y: -';
      });
    } catch (_err) {
      // Ignore cross-origin or access issues.
    }
  });

  wrapper.appendChild(frame);
  wrapper.appendChild(coordLabel);
  document.body.appendChild(wrapper);
})();
