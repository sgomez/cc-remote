document.addEventListener('DOMContentLoaded', () => {
  // --- Helper: Escape HTML special characters to prevent XSS ---
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Screens
  const loginScreen = document.getElementById('login-screen');
  const dashboardScreen = document.getElementById('dashboard-screen');
  
  // Login & Error Elements
  const btnLoginGithub = document.getElementById('btn-login-github');
  const loginError = document.getElementById('login-error');
  
  // Dashboard & Navigation
  const btnLogout = document.getElementById('btn-logout');
  const sessionsGrid = document.getElementById('sessions-grid');
  const emptyState = document.getElementById('empty-state');
  const btnRefreshSessions = document.getElementById('btn-refresh-sessions');
  const btnNewSession = document.getElementById('btn-new-session');
  const btnEmptyNewSession = document.getElementById('btn-empty-new-session');
  
  // Modal: Create Session
  const createModal = document.getElementById('create-modal');
  const createForm = document.getElementById('create-session-form');
  const sessionNameInput = document.getElementById('session-name-input');
  const repoSearchInput = document.getElementById('repo-search-input');
  const repoDropdownList = document.getElementById('repo-dropdown-list');
  const repoSelectGroup = document.getElementById('repo-select-group');
  const btnReloadRepos = document.getElementById('btn-reload-repos');
  const toggleManualRepo = document.getElementById('toggle-manual-repo');
  const manualRepoGroup = document.getElementById('manual-repo-group');
  const repoManualInput = document.getElementById('repo-manual-input');
  const createError = document.getElementById('create-error');
  const btnSubmitCreate = document.getElementById('btn-submit-create');

  // Modal: Confirm Delete
  const deleteModal = document.getElementById('delete-modal');
  const deleteSessionDisplay = document.getElementById('delete-session-display');
  const deleteError = document.getElementById('delete-error');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete');

  // Modal: Confirm Reset
  const resetModal = document.getElementById('reset-modal');
  const resetSessionDisplay = document.getElementById('reset-session-display');
  const resetError = document.getElementById('reset-error');
  const btnConfirmReset = document.getElementById('btn-confirm-reset');

  // Modal: Clone Session
  const cloneModal = document.getElementById('clone-modal');
  const cloneForm = document.getElementById('clone-session-form');
  const cloneNameInput = document.getElementById('clone-name-input');
  const cloneRepoDisplay = document.getElementById('clone-repo-display');
  const cloneError = document.getElementById('clone-error');
  const btnSubmitClone = document.getElementById('btn-submit-clone');

  // Modal: View Logs
  const logsModal = document.getElementById('logs-modal');
  const logsSessionDisplay = document.getElementById('logs-session-display');
  const logsContent = document.getElementById('logs-content');
  const btnRefreshLogs = document.getElementById('btn-refresh-logs');

  // State
  let activeDeleteSessionName = null;
  let activeResetSessionName = null;
  let activeResetSessionRunning = false;
  let activeCloneSessionName = null;
  let activeCloneRepo = null;
  let activeLogsSessionName = null;
  let isManualRepoActive = false;
  let repositories = [];
  let lastSessionsStateJson = '';

  // Initialize Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Check URL query parameters for OAuth authentication errors
  checkQueryErrors();

  // Check Authentication on Page Load
  checkAuth();

  // --- Auth Functions ---
  function checkQueryErrors() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      loginError.classList.remove('hidden');
      const errorMsg = loginError.querySelector('.error-msg');
      
      switch (error) {
        case 'unauthorized':
          errorMsg.textContent = 'Access denied. Your GitHub account is not in the ALLOWED_GITHUB_USERS list.';
          break;
        case 'token_exchange_failed':
          errorMsg.textContent = 'Authentication failed: Unable to exchange code for token.';
          break;
        case 'profile_fetch_failed':
          errorMsg.textContent = 'Authentication failed: Unable to fetch GitHub user profile.';
          break;
        case 'no_code_provided':
          errorMsg.textContent = 'Authentication failed: GitHub auth code not received.';
          break;
        case 'server_error':
          errorMsg.textContent = 'Authentication failed: An internal server error occurred.';
          break;
        default:
          errorMsg.textContent = 'Authentication failed. Please try again.';
      }

      // Clear query params to make URL clean
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/check');
      const data = await res.json();
      if (data.authenticated) {
        showScreen('dashboard');
        loadSessions();
      } else {
        showScreen('login');
      }
    } catch (e) {
      showScreen('login');
    }
  }

  function showScreen(screen) {
    if (screen === 'dashboard') {
      loginScreen.classList.add('hidden');
      dashboardScreen.classList.remove('hidden');
    } else {
      loginScreen.classList.remove('hidden');
      dashboardScreen.classList.add('hidden');
    }
  }

  // Handle GitHub Login redirect
  btnLoginGithub.addEventListener('click', () => {
    window.location.href = '/api/auth/login';
  });

  // Handle Logout
  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      lastSessionsStateJson = '';
      showScreen('login');
    } catch (e) {
      lastSessionsStateJson = '';
      showScreen('login');
    }
  });

  // --- Sessions Functions ---
  async function loadSessions() {
    try {
      const res = await fetch('/api/sessions');
      if (res.status === 401) {
        showScreen('login');
        return;
      }
      
      const sessions = await res.json();
      const currentStateJson = JSON.stringify(sessions.map(s => ({ name: s.name, status: s.status, created: s.created })));
      if (currentStateJson === lastSessionsStateJson) {
        return;
      }
      lastSessionsStateJson = currentStateJson;

      sessionsGrid.innerHTML = '';
      if (sessions.length === 0) {
        sessionsGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
      }

      sessionsGrid.classList.remove('hidden');
      emptyState.classList.add('hidden');

      sessions.forEach(session => {
        const isRunning = session.status === 'running';
        const isCloning = session.status === 'cloning';
        const isCloneFailed = session.status === 'clone_failed';

        let statusClass = 'stopped';
        if (isRunning) statusClass = 'running';
        else if (isCloning) statusClass = 'cloning';
        else if (isCloneFailed) statusClass = 'clone_failed';
        
        const card = document.createElement('div');
        card.className = 'glass-card session-card';
        const safeName = escapeHtml(session.name);
        const safeRepo = escapeHtml(session.repo);
        const safeStatus = escapeHtml(session.status);
        const safeRepoHref = encodeURI(session.repo);

        let actionButtonHtml = '';
        if (isCloning) {
          actionButtonHtml = `<button type="button" class="btn btn-secondary btn-sm" disabled><i data-lucide="loader-2" class="spin" style="width: 14px; height: 14px;"></i> Cloning...</button>`;
        } else if (isCloneFailed) {
          actionButtonHtml = `<button type="button" class="btn btn-warning btn-sm btn-reset" data-name="${safeName}" data-running="false"><i data-lucide="rotate-ccw" style="width: 14px; height: 14px;"></i> Retry</button>`;
        } else if (isRunning) {
          actionButtonHtml = `<button type="button" class="btn btn-secondary btn-sm btn-stop" data-name="${safeName}"><i data-lucide="square" style="width: 14px; height: 14px;"></i> Stop</button>`;
        } else {
          actionButtonHtml = `<button type="button" class="btn btn-primary btn-sm btn-start" data-name="${safeName}"><i data-lucide="play" style="width: 14px; height: 14px;"></i> Start</button>`;
        }

        card.innerHTML = `
          <div class="session-header">
            <div class="session-meta">
              <h4>${safeName}</h4>
              <a href="https://github.com/${safeRepoHref}" target="_blank" class="repo-link">
                <i data-lucide="github" style="width: 14px; height: 14px;"></i>
                <span>${safeRepo}</span>
              </a>
            </div>
            <div class="status-badge ${statusClass}">
              <span class="status-dot"></span>
              <span>${safeStatus}</span>
            </div>
          </div>
          <div class="session-footer">
            <span class="text-muted" style="font-size: 0.8rem;">Created: ${new Date(session.created * 1000).toLocaleDateString()}</span>
            <div class="session-actions">
              ${actionButtonHtml}
              <div class="dropdown">
                <button type="button" class="btn btn-secondary btn-sm dropdown-toggle" data-name="${safeName}">
                  <span>Actions</span>
                  <i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 2px;"></i>
                </button>
                <div class="dropdown-menu">
                  <button type="button" class="dropdown-item btn-logs" data-name="${safeName}">
                    <i data-lucide="scroll"></i>
                    <span>Logs</span>
                  </button>
                  <button type="button" class="dropdown-item btn-clone" data-name="${safeName}" data-repo="${safeRepo}" ${isCloning || isCloneFailed ? 'disabled' : ''}>
                    <i data-lucide="copy"></i>
                    <span>Clone</span>
                  </button>
                  <button type="button" class="dropdown-item btn-reset text-warning" data-name="${safeName}" data-running="${isRunning}" ${isCloning ? 'disabled' : ''}>
                    <i data-lucide="rotate-ccw"></i>
                    <span>Reset</span>
                  </button>
                  <button type="button" class="dropdown-item btn-delete text-danger" data-name="${safeName}" ${(isRunning || isCloning) ? 'disabled title="Stop the container or wait for cloning to finish before deleting."' : ''}>
                    <i data-lucide="trash-2"></i>
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
        sessionsGrid.appendChild(card);
      });

      // Re-trigger Lucide Icons on dynamic elements
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }

      // Bind events
      document.querySelectorAll('.btn-start').forEach(btn => {
        btn.addEventListener('click', () => controlSession(btn.dataset.name, 'start'));
      });
      document.querySelectorAll('.btn-stop').forEach(btn => {
        btn.addEventListener('click', () => controlSession(btn.dataset.name, 'stop'));
      });
      document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!btn.hasAttribute('disabled')) {
            openDeleteModal(btn.dataset.name);
          }
        });
      });
      document.querySelectorAll('.btn-logs').forEach(btn => {
        btn.addEventListener('click', () => openLogsModal(btn.dataset.name));
      });
      document.querySelectorAll('.btn-reset').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.name;
          const running = btn.dataset.running === 'true';
          openResetModal(name, running);
        });
      });
      document.querySelectorAll('.btn-clone').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.name;
          const repo = btn.dataset.repo;
          openCloneModal(name, repo);
        });
      });

    } catch (err) {
      console.error(err);
    }
  }

  async function controlSession(name, action) {
    try {
      const res = await fetch(`/api/sessions/${name}/${action}`, { method: 'POST' });
      if (res.ok) {
        loadSessions();
      } else {
        const data = await res.json();
        alert(data.error || `Failed to ${action} session.`);
      }
    } catch (e) {
      alert(`Network error while trying to ${action} session.`);
    }
  }

  btnRefreshSessions.addEventListener('click', loadSessions);

  // --- Modal Helpers ---
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      createModal.classList.add('hidden');
      deleteModal.classList.add('hidden');
      resetModal.classList.add('hidden');
      cloneModal.classList.add('hidden');
      logsModal.classList.add('hidden');
      activeLogsSessionName = null;
      activeResetSessionName = null;
      activeCloneSessionName = null;
    });
  });

  // --- Create Session Modal ---
  const openCreateModal = () => {
    createError.classList.add('hidden');
    sessionNameInput.value = '';
    repoManualInput.value = '';
    repoSearchInput.value = '';
    isManualRepoActive = false;
    manualRepoGroup.classList.add('hidden');
    repoSelectGroup.classList.remove('hidden');
    btnReloadRepos.classList.remove('hidden');
    toggleManualRepo.textContent = 'Or enter repository path manually';
    createModal.classList.remove('hidden');
    loadRepos();
  };

  btnNewSession.addEventListener('click', openCreateModal);
  btnEmptyNewSession.addEventListener('click', openCreateModal);

  toggleManualRepo.addEventListener('click', (e) => {
    e.preventDefault();
    isManualRepoActive = !isManualRepoActive;
    if (isManualRepoActive) {
      manualRepoGroup.classList.remove('hidden');
      repoSelectGroup.classList.add('hidden');
      btnReloadRepos.classList.add('hidden');
      repoSearchInput.removeAttribute('required');
      repoManualInput.setAttribute('required', 'required');
      toggleManualRepo.textContent = 'Use repository list selection';
    } else {
      manualRepoGroup.classList.add('hidden');
      repoSelectGroup.classList.remove('hidden');
      btnReloadRepos.classList.remove('hidden');
      repoSearchInput.setAttribute('required', 'required');
      repoManualInput.removeAttribute('required');
      toggleManualRepo.textContent = 'Or enter repository path manually';
    }
  });

  // Filter and render repositories inside the combobox dropdown
  function renderDropdown(filterText = '') {
    repoDropdownList.innerHTML = '';
    const filtered = repositories.filter(repo => 
      repo.full_name.toLowerCase().includes(filterText.toLowerCase())
    );

    if (filtered.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'combobox-item';
      emptyDiv.style.cursor = 'default';
      emptyDiv.style.color = 'var(--text-muted)';
      emptyDiv.textContent = 'No matching repositories';
      repoDropdownList.appendChild(emptyDiv);
      return;
    }

    filtered.forEach(repo => {
      const item = document.createElement('div');
      item.className = 'combobox-item';
      item.dataset.value = repo.full_name;
      item.innerHTML = `
        <span>${escapeHtml(repo.full_name)}</span>
        ${repo.private ? '<span class="item-private">Private</span>' : ''}
      `;

      item.addEventListener('click', () => {
        repoSearchInput.value = repo.full_name;
        repoDropdownList.classList.add('hidden');
      });

      repoDropdownList.appendChild(item);
    });
  }

  // Handle typing inside search input
  repoSearchInput.addEventListener('input', (e) => {
    renderDropdown(e.target.value);
    repoDropdownList.classList.remove('hidden');
  });

  // Focus displays list
  repoSearchInput.addEventListener('focus', () => {
    renderDropdown(repoSearchInput.value);
    repoDropdownList.classList.remove('hidden');
  });

  // Clicking outside the combobox wrapper closes it
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.combobox-wrapper')) {
      repoDropdownList.classList.add('hidden');
    }
  });

  async function loadRepos() {
    repositories = [];
    repoSearchInput.value = '';
    repoSearchInput.placeholder = 'Loading repositories...';
    repoSearchInput.setAttribute('disabled', 'disabled');
    
    try {
      const res = await fetch('/api/repos');
      if (!res.ok) {
        throw new Error('Failed response');
      }
      repositories = await res.json();
      repoSearchInput.placeholder = 'Search or select a repository...';
      repoSearchInput.removeAttribute('disabled');
      renderDropdown();
    } catch (err) {
      repoSearchInput.placeholder = 'Failed to load repositories.';
      repositories = [];
    }
  }

  btnReloadRepos.addEventListener('click', loadRepos);

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.classList.add('hidden');

    const name = sessionNameInput.value.trim();
    const repo = isManualRepoActive ? repoManualInput.value.trim() : repoSearchInput.value.trim();

    // Frontend validations
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      showError(createError, 'Session name must be alphanumeric with hyphens or underscores.');
      return;
    }

    if (!repo || !repo.includes('/')) {
      showError(createError, 'Please select or input a valid repository (owner/name).');
      return;
    }

    // Toggle loader
    const btnText = btnSubmitCreate.querySelector('span');
    const btnSpinner = btnSubmitCreate.querySelector('.spin');
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    btnSubmitCreate.setAttribute('disabled', 'disabled');

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, repo })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        createModal.classList.add('hidden');
        loadSessions();
      } else {
        showError(createError, data.error || 'Failed to create container session.');
      }
    } catch (err) {
      showError(createError, 'Network error. Failed to connect to server.');
    } finally {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
      btnSubmitCreate.removeAttribute('disabled');
    }
  });

  // --- Logs Modal ---
  async function openLogsModal(name) {
    activeLogsSessionName = name;
    logsSessionDisplay.textContent = name;
    logsContent.textContent = 'Loading container logs...';
    logsModal.classList.remove('hidden');
    await fetchLogs(name);
  }

  async function fetchLogs(name) {
    try {
      const res = await fetch(`/api/sessions/${name}/logs`);
      if (res.status === 401) {
        showScreen('login');
        return;
      }
      const data = await res.json();
      if (res.ok) {
        logsContent.textContent = data.logs || 'No logs available for this container.';
        logsContent.scrollTop = logsContent.scrollHeight;
      } else {
        logsContent.textContent = `Error: ${data.error || 'Failed to retrieve logs.'}`;
      }
    } catch (e) {
      logsContent.textContent = 'Network error while retrieving container logs.';
    }
  }

  btnRefreshLogs.addEventListener('click', () => {
    if (activeLogsSessionName) {
      logsContent.textContent = 'Refreshing logs...';
      fetchLogs(activeLogsSessionName);
    }
  });

  // --- Delete Session Modal ---
  function openDeleteModal(name) {
    activeDeleteSessionName = name;
    deleteSessionDisplay.textContent = name;
    deleteError.classList.add('hidden');
    deleteModal.classList.remove('hidden');
  }

  btnConfirmDelete.addEventListener('click', async () => {
    if (!activeDeleteSessionName) return;

    deleteError.classList.add('hidden');

    // Toggle loader
    const btnText = btnConfirmDelete.querySelector('span');
    const btnSpinner = btnConfirmDelete.querySelector('.spin');
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    btnConfirmDelete.setAttribute('disabled', 'disabled');

    try {
      const res = await fetch(`/api/sessions/${activeDeleteSessionName}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (res.ok) {
        deleteModal.classList.add('hidden');
        loadSessions();
      } else {
        const data = await res.json();
        showError(deleteError, data.error || 'Failed to delete container session.');
        btnConfirmDelete.removeAttribute('disabled');
      }
    } catch (err) {
      showError(deleteError, 'Network error. Failed to reach server.');
      btnConfirmDelete.removeAttribute('disabled');
    } finally {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
      activeDeleteSessionName = null;
    }
  });

  // --- Reset Session Modal ---
  function openResetModal(name, isRunning) {
    activeResetSessionName = name;
    activeResetSessionRunning = isRunning;
    resetSessionDisplay.textContent = name;
    resetError.classList.add('hidden');
    resetModal.classList.remove('hidden');
  }

  btnConfirmReset.addEventListener('click', async () => {
    if (!activeResetSessionName) return;

    resetError.classList.add('hidden');
    const btnText = btnConfirmReset.querySelector('span');
    const btnSpinner = btnConfirmReset.querySelector('.spin');
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    btnConfirmReset.setAttribute('disabled', 'disabled');

    try {
      const res = await fetch(`/api/sessions/${activeResetSessionName}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ running: activeResetSessionRunning })
      });

      if (res.ok) {
        resetModal.classList.add('hidden');
        loadSessions();
      } else {
        const data = await res.json();
        showError(resetError, data.error || 'Failed to reset session.');
      }
    } catch (err) {
      showError(resetError, 'Network error. Failed to reach server.');
    } finally {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
      btnConfirmReset.removeAttribute('disabled');
      activeResetSessionName = null;
    }
  });

  // --- Clone Session Modal ---
  function openCloneModal(name, repo) {
    activeCloneSessionName = name;
    activeCloneRepo = repo;
    
    // Fill the clone modal with default name using current timestamp in seconds
    const timestamp = Math.floor(Date.now() / 1000);
    cloneNameInput.value = `${name}-clone-${timestamp}`;
    cloneRepoDisplay.value = repo;
    cloneError.classList.add('hidden');
    cloneModal.classList.remove('hidden');
  }

  cloneForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeCloneSessionName || !activeCloneRepo) return;

    const newName = cloneNameInput.value.trim();
    if (!newName) return;

    cloneError.classList.add('hidden');
    const btnText = btnSubmitClone.querySelector('span');
    const btnSpinner = btnSubmitClone.querySelector('.spin');
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    btnSubmitClone.setAttribute('disabled', 'disabled');

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, repo: activeCloneRepo })
      });

      if (res.ok) {
        cloneModal.classList.add('hidden');
        loadSessions();
      } else {
        const data = await res.json();
        showError(cloneError, data.error || 'Failed to clone session.');
      }
    } catch (err) {
      showError(cloneError, 'Network error. Failed to reach server.');
    } finally {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
      btnSubmitClone.removeAttribute('disabled');
      activeCloneSessionName = null;
      activeCloneRepo = null;
    }
  });

  // --- Helper: Display Error ---
  function showError(element, message) {
    element.querySelector('.error-msg').textContent = message;
    element.classList.remove('hidden');
  }

  // --- Global Dropdown Logic ---
  document.addEventListener('click', (e) => {
    const isDropdownToggle = e.target.closest('.dropdown-toggle');
    if (!isDropdownToggle) {
      document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.remove('show'));
      return;
    }

    const currentMenu = isDropdownToggle.nextElementSibling;
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
      if (menu !== currentMenu) {
        menu.classList.remove('show');
      }
    });

    currentMenu.classList.toggle('show');
  });

  // Periodically refresh sessions (every 4 seconds) to keep status in sync
  setInterval(() => {
    if (!dashboardScreen.classList.contains('hidden')) {
      loadSessions();
    }
  }, 4000);
});
