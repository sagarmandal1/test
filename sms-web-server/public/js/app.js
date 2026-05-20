// Client-side Application Controller for SMS Sync Portal

document.addEventListener('DOMContentLoaded', () => {
  // Authentication State
  let apiKey = localStorage.getItem('api_key') || '';
  
  // App State Management
  let smsData = [];
  let devices = [];
  let currentSearch = '';
  let currentDeviceFilter = '';
  let soundEnabled = true;
  let activeFilterDeviceId = ''; // Filter by clicking sidebar device
  let eventSource = null;

  // DOM Elements
  const deviceList = document.getElementById('deviceList');
  const smsList = document.getElementById('smsList');
  const searchInput = document.getElementById('searchInput');
  const deviceFilter = document.getElementById('deviceFilter');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const lockStatusBtn = document.getElementById('lockStatusBtn');
  const exportBtn = document.getElementById('exportBtn');
  const smsCount = document.getElementById('smsCount');
  const serverIp = document.getElementById('serverIp');
  const chimeSound = document.getElementById('chimeSound');
  
  // Auth Overlay DOM Elements
  const authOverlay = document.getElementById('authOverlay');
  const authApiKeyInput = document.getElementById('authApiKeyInput');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const authErrorMsg = document.getElementById('authErrorMsg');

  // Modal Elements
  const detailModal = document.getElementById('detailModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalBody = document.getElementById('modalBody');

  // Initialize Web Portal based on Auth State
  if (!apiKey) {
    showAuthOverlay();
  } else {
    validateSavedToken();
  }

  // 1. Authentication Handlers
  function showAuthOverlay() {
    authOverlay.classList.remove('hidden');
    authApiKeyInput.focus();
  }

  function hideAuthOverlay() {
    authOverlay.classList.add('hidden');
  }

  // Try validating key on submit
  authSubmitBtn.addEventListener('click', performAuthLogin);
  authApiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performAuthLogin();
  });

  async function performAuthLogin() {
    const inputToken = authApiKeyInput.value.trim();
    if (!inputToken) return;

    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = 'Verifying Token...';
    authErrorMsg.classList.add('hidden');

    try {
      const response = await fetch('/api/devices', {
        headers: { 'Authorization': `Bearer ${inputToken}` }
      });

      if (response.ok) {
        // Auth Success!
        apiKey = inputToken;
        localStorage.setItem('api_key', apiKey);
        hideAuthOverlay();
        initializePortal();
      } else {
        // Unauthorized
        authErrorMsg.classList.remove('hidden');
        authApiKeyInput.value = '';
        authApiKeyInput.focus();
      }
    } catch (err) {
      console.error('Login error:', err);
      authErrorMsg.textContent = 'Network connection failed. Try again.';
      authErrorMsg.classList.remove('hidden');
    } finally {
      authSubmitBtn.disabled = false;
      authSubmitBtn.textContent = 'Unlock Dashboard';
    }
  }

  async function validateSavedToken() {
    try {
      const response = await fetch('/api/devices', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (response.ok) {
        hideAuthOverlay();
        initializePortal();
      } else {
        // Stale cached token, wipe and prompt login
        localStorage.removeItem('api_key');
        apiKey = '';
        showAuthOverlay();
      }
    } catch (err) {
      // Offline fallback: try connecting anyway or show prompt
      console.warn('Authentication check offline, loading cached UI state.', err);
      hideAuthOverlay();
      initializePortal();
    }
  }

  // 2. Initialize Core App Portal once authenticated
  function initializePortal() {
    // Detect Host IP
    const host = window.location.host;
    const protocol = window.location.protocol;
    serverIp.textContent = `Server: ${protocol}//${host}`;

    // Fetch initial datasets
    fetchDevices();
    fetchSMS();

    // SSE connection
    connectSSE();
  }

  // Setup Server-Sent Events (SSE) for Real-Time Synchronization
  function connectSSE() {
    if (eventSource) eventSource.close();
    
    const sseUrl = `/api/events?api_key=${encodeURIComponent(apiKey)}`;
    console.log(`Connecting to SSE stream...`);
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      console.log('SSE connection successfully opened!');
      serverIp.classList.add('live-glow');
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error, attempting auto-reconnect:', err);
      serverIp.classList.remove('live-glow');
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        console.log('Received SSE Event:', payload.type, payload.data);

        if (payload.type === 'new_sms') {
          handleIncomingSMS(payload.data);
        } else if (payload.type === 'device_update') {
          handleDeviceUpdate(payload.data);
        } else if (payload.type === 'bulk_sync') {
          fetchDevices();
          fetchSMS();
          playChime();
        }
      } catch (e) {
        console.error('Error parsing SSE message:', e);
      }
    };
  }

  // 3. API Core Actions
  async function fetchDevices() {
    try {
      const response = await fetch('/api/devices', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!response.ok) throw new Error('Network error fetching devices');
      devices = await response.json();
      renderDevices();
      updateDeviceDropdown();
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchSMS() {
    try {
      smsList.innerHTML = `
        <div class="feed-loading">
          <div class="spinner"></div>
          <span>Loading messages feed...</span>
        </div>
      `;

      const url = new URL('/api/sms', window.location.origin);
      if (currentSearch) url.searchParams.append('search', currentSearch);
      
      const filterId = activeFilterDeviceId || currentDeviceFilter;
      if (filterId) url.searchParams.append('device', filterId);

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!response.ok) throw new Error('Network error fetching SMS');
      smsData = await response.json();
      renderSMSList();
    } catch (err) {
      smsList.innerHTML = `
        <div class="feed-empty">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
          <span>Error loading SMS feed. Verify API key or connection.</span>
        </div>
      `;
    }
  }

  // 4. Rendering Handlers
  function renderDevices() {
    if (devices.length === 0) {
      deviceList.innerHTML = `<div class="no-devices">No devices synced yet.<br><small style="color:var(--color-text-muted)">Configure your Android app with this URL & token to start syncing.</small></div>`;
      return;
    }

    deviceList.innerHTML = '';
    devices.forEach(dev => {
      const isSelected = activeFilterDeviceId === dev.device_id ? 'active-filter' : '';
      
      let batteryClass = 'high';
      if (dev.battery < 20) batteryClass = 'low';
      else if (dev.battery < 60) batteryClass = 'medium';

      const lastSeenText = formatRelativeTime(dev.last_seen);
      const statusClass = dev.status.toLowerCase() === 'active' ? 'green' : 'orange';

      const card = document.createElement('div');
      card.className = `device-card ${isSelected}`;
      card.dataset.id = dev.device_id;
      card.innerHTML = `
        <div class="device-avatar">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg>
        </div>
        <div class="device-info">
          <div class="device-name">${escapeHTML(dev.device_name)}</div>
          <div class="device-meta">
            <span class="status-dot ${statusClass}" title="Status: ${dev.status}"></span>
            <span class="battery-indicator ${batteryClass}">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"/><line x1="22" x2="22" y1="11" y2="13"/></svg>
              ${dev.battery}%
            </span>
            <span title="Last Seen">${lastSeenText}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        if (activeFilterDeviceId === dev.device_id) {
          activeFilterDeviceId = '';
        } else {
          activeFilterDeviceId = dev.device_id;
        }
        deviceFilter.value = activeFilterDeviceId;
        fetchDevices();
        fetchSMS();
      });

      deviceList.appendChild(card);
    });
  }

  function updateDeviceDropdown() {
    const prevValue = deviceFilter.value;
    deviceFilter.innerHTML = '<option value="">All Phones</option>';
    devices.forEach(dev => {
      const opt = document.createElement('option');
      opt.value = dev.device_id;
      opt.textContent = dev.device_name;
      deviceFilter.appendChild(opt);
    });
    deviceFilter.value = prevValue;
  }

  function renderSMSList() {
    smsCount.textContent = `${smsData.length} Messages`;

    if (smsData.length === 0) {
      smsList.innerHTML = `
        <div class="feed-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>No matching messages found.</span>
        </div>
      `;
      return;
    }

    smsList.innerHTML = '';
    smsData.forEach(sms => {
      const card = createSMSCard(sms);
      smsList.appendChild(card);
    });
  }

  function createSMSCard(sms) {
    const relativeTime = formatRelativeTime(sms.timestamp);
    const firstChar = sms.sender.match(/[a-zA-Z]/) ? sms.sender.charAt(0).toUpperCase() : '#';
    const cleanMessage = highlightOTP(escapeHTML(sms.message));
    
    const simSlotText = `SIM ${sms.sim_slot}`;
    const simClass = sms.sim_slot === 2 ? 'sim-2' : 'sim-1';

    const card = document.createElement('div');
    card.className = 'sms-card';
    card.dataset.id = sms.id;
    card.innerHTML = `
      <div class="sender-avatar">${firstChar}</div>
      <div class="sms-body-container">
        <div class="sms-card-header">
          <span class="sender-number">${escapeHTML(sms.sender)}</span>
          <span class="time-badge" title="${new Date(sms.timestamp).toLocaleString()}">${relativeTime}</span>
        </div>
        <div class="sms-message">${cleanMessage}</div>
        <div class="sms-card-footer">
          <span class="smart-tag tag-device">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg>
            ${escapeHTML(sms.device_name)}
          </span>
          <span class="smart-tag tag-sim ${simClass}">${simSlotText}</span>
        </div>
      </div>
      <button class="copy-bubble-btn" data-text="${escapeHTML(sms.message)}">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy Text
      </button>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.copy-bubble-btn')) return;
      openModal(sms);
    });

    const copyBtn = card.querySelector('.copy-bubble-btn');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(copyBtn.dataset.text).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy Text
          `;
          copyBtn.classList.remove('copied');
        }, 1500);
      });
    });

    return card;
  }

  // 5. SSE Event Real-time Processing
  function handleIncomingSMS(sms) {
    smsData.unshift(sms);
    smsCount.textContent = `${smsData.length} Messages`;

    const filterId = activeFilterDeviceId || currentDeviceFilter;
    if (filterId && sms.device_id !== filterId) return;

    if (currentSearch) {
      const searchLower = currentSearch.toLowerCase();
      if (!sms.sender.toLowerCase().includes(searchLower) && !sms.message.toLowerCase().includes(searchLower)) {
        return;
      }
    }

    const card = createSMSCard(sms);
    card.classList.add('new-alert');
    
    const emptyState = smsList.querySelector('.feed-empty');
    if (emptyState) emptyState.remove();

    smsList.insertBefore(card, smsList.firstChild);
    playChime();

    setTimeout(() => {
      card.classList.remove('new-alert');
    }, 3000);
  }

  function handleDeviceUpdate(device) {
    const index = devices.findIndex(d => d.device_id === device.device_id);
    if (index !== -1) {
      devices[index] = device;
    } else {
      devices.push(device);
    }
    renderDevices();
    updateDeviceDropdown();
  }

  // 6. OTP Extraction Helper Function (regex)
  function highlightOTP(text) {
    const otpRegex = /\b\d{4,8}\b/g;
    const lowerText = text.toLowerCase();
    
    const isOtpLikely = ['otp', 'code', 'pin', 'verification', 'verify', 'verification code'].some(keyword => 
      lowerText.includes(keyword)
    );

    if (isOtpLikely) {
      return text.replace(otpRegex, (match) => {
        return `<span class="otp-highlight">${match}</span>`;
      });
    }
    return text;
  }

  // 7. Modal Drawer Handlers
  function openModal(sms) {
    const formattedTime = new Date(sms.timestamp).toLocaleString();
    const otpMatch = sms.message.match(/\b\d{4,8}\b/);
    const otpBtnHtml = otpMatch ? `
      <button class="action-btn primary" id="modalCopyOtpBtn" data-otp="${otpMatch[0]}">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        Copy OTP [${otpMatch[0]}]
      </button>
    ` : '';

    modalBody.innerHTML = `
      <div class="modal-section">
        <div class="modal-label">Sender</div>
        <div class="modal-value" style="font-weight: 600; font-size: 1.1rem; color: #fff;">${escapeHTML(sms.sender)}</div>
      </div>
      <div class="modal-section">
        <div class="modal-label">Message Content</div>
        <div class="modal-message-box">${highlightOTP(escapeHTML(sms.message))}</div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;" class="modal-section">
        <div>
          <div class="modal-label">Received On Device</div>
          <div class="modal-value">${escapeHTML(sms.device_name)}</div>
        </div>
        <div>
          <div class="modal-label">SIM Slot</div>
          <div class="modal-value">SIM ${sms.sim_slot}</div>
        </div>
      </div>
      <div class="modal-section">
        <div class="modal-label">Timestamp</div>
        <div class="modal-value">${formattedTime}</div>
      </div>
      <div class="modal-actions">
        ${otpBtnHtml}
        <button class="action-btn secondary" id="modalCopyFullBtn" data-text="${escapeHTML(sms.message)}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          Copy Full Message
        </button>
      </div>
    `;

    detailModal.classList.add('show');

    if (otpMatch) {
      const copyOtpBtn = document.getElementById('modalCopyOtpBtn');
      copyOtpBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(copyOtpBtn.dataset.otp).then(() => {
          copyOtpBtn.textContent = 'OTP Copied!';
          copyOtpBtn.style.background = 'var(--color-active)';
          setTimeout(() => {
            detailModal.classList.remove('show');
          }, 800);
        });
      });
    }

    const copyFullBtn = document.getElementById('modalCopyFullBtn');
    copyFullBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(copyFullBtn.dataset.text).then(() => {
        copyFullBtn.textContent = 'Message Copied!';
        copyFullBtn.style.borderColor = 'var(--color-active)';
        copyFullBtn.style.color = 'var(--color-active)';
        setTimeout(() => {
          detailModal.classList.remove('show');
        }, 800);
      });
    });
  };

  closeModalBtn.addEventListener('click', () => {
    detailModal.classList.remove('show');
  });

  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) detailModal.classList.remove('show');
  });

  // 8. Sound, Lockout & UI Event Listeners
  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
      soundToggleBtn.classList.add('sound-enabled');
      soundToggleBtn.querySelector('.icon-speaker-on').classList.remove('hidden');
      soundToggleBtn.querySelector('.icon-speaker-off').classList.add('hidden');
    } else {
      soundToggleBtn.classList.remove('sound-enabled');
      soundToggleBtn.querySelector('.icon-speaker-on').classList.add('hidden');
      soundToggleBtn.querySelector('.icon-speaker-off').classList.remove('hidden');
    }
  });

  // Lock Button: Logout
  lockStatusBtn.addEventListener('click', () => {
    const confirmLogout = confirm('Are you sure you want to log out and lock the dashboard?');
    if (confirmLogout) {
      localStorage.removeItem('api_key');
      apiKey = '';
      if (eventSource) eventSource.close();
      window.location.reload();
    }
  });

  function playChime() {
    if (!soundEnabled) return;
    chimeSound.currentTime = 0;
    chimeSound.play().catch(e => console.log('Chime sound could not play: ', e));
  }

  // Interactive Live Search
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentSearch = e.target.value.trim();
      fetchSMS();
    }, 300);
  });

  // Dropdown Device Filter
  deviceFilter.addEventListener('change', (e) => {
    currentDeviceFilter = e.target.value;
    activeFilterDeviceId = ''; 
    
    const cards = deviceList.querySelectorAll('.device-card');
    cards.forEach(c => c.classList.remove('active-filter'));
    if (currentDeviceFilter) {
      const activeCard = Array.from(cards).find(c => c.dataset.id === currentDeviceFilter);
      if (activeCard) activeCard.classList.add('active-filter');
    }

    fetchSMS();
  });

  // Export JSON
  exportBtn.addEventListener('click', () => {
    if (smsData.length === 0) return alert('No messages to export');
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(smsData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `SMS_Log_Export_${new Date().toISOString().substring(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // 9. Time Formatting Helpers
  function formatRelativeTime(epochTime) {
    const seconds = Math.floor((Date.now() - epochTime) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
