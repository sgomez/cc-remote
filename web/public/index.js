document.addEventListener('DOMContentLoaded', () => {
  // Screens
  const loginScreen = document.getElementById('login-screen');
  const dashboardScreen = document.getElementById('dashboard-screen');
  
  // Forms & Inputs
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const otpInput = document.getElementById('otp');
  const loginError = document.getElementById('login-error');
  
  // Dashboard & Navigation
  const btnLogout = document.getElementById('btn-logout');
  const btnShowSettings = document.getElementById('btn-show-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const settingsPanel = document.getElementById('settings-panel');
  const tokenOverrideInput = document.getElementById('github-token-override');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnClearSettings = document.getElementById('btn-clear-settings');
  
  const sessionsGrid = document.getElementById('sessions-grid');
  const emptyState = document.getElementById('empty-state');
  const btnRefreshSessions = document.getElementById('btn-refresh-sessions');
  const btnNewSession = document.getElementById('btn-new-session');
  const btnEmptyNewSession = document.getElementById('btn-empty-new-session');
  
  // Modal: Create Session
  const createModal = document.getElementById('create-modal');
  const createForm = document.getElementById('create-session-form');
  const sessionNameInput = document.getElementById('session-name-input');
  const repoSelect = document.getElementById('repo-select');
  const btnReloadRepos = document.getElementById('btn-reload-repos');
  const toggleManualRepo = document.getElementById('toggle-manual-repo');
  const manualRepoGroup = document.getElementById('manual-repo-group');
  const repoManualInput = document.getElementById('repo-manual-input');
  const createError = document.getElementById('create-error');
  const btnSubmitCreate = document.getElementById('btn-submit-create');

  // Modal: Confirm Delete
  const deleteModal = document.getElementById('delete-modal');
  const deleteSessionDisplay = document.getElementById('delete-session-display');
  const deleteVolumeCheckbox = document.getElementById('delete-volume-checkbox');
  const deleteError = document.getElementById('delete-error');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete');

  // State
  let activeDeleteSessionName = null;
  let isManualRepoActive = false;

  // Initialize Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Check Authentication on Page Load
  checkAuth();

  // Load saved token override from LocalStorage
  const savedToken = localStorage.getItem('github_token_override');
  if (savedToken) {
    tokenOverrideInput.value = savedToken;
  }

  // --- Auth Functions ---
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

  // Handle Login Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    
    const password = passwordInput.value;
    const otp = otpInput.value.trim();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, otp })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        passwordInput.value = '';
        otpInput.value = '';
        showScreen('dashboard');
        loadSessions();
      } else {
        showError(loginError, data.error || 'Invalid credentials.');
      }
    } catch (err) {
      showError(loginError, 'Network error. Please try again.');
    }
  });

  // Handle Logout
  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      showScreen('login');
    } catch (e) {
      showScreen('login');
    }
  });

  // --- Settings Panel ---
  btnShowSettings.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });
  btnCloseSettings.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  btnSaveSettings.addEventListener('click', () => {
    const val = tokenOverrideInput.value.trim();
    if (val) {
      localStorage.setItem('github_token_override', val);
      alert('GitHub token override saved!');
    } else {
      localStorage.removeItem('github_token_override');
      alert('Token override cleared.');
    }
    settingsPanel.classList.add('hidden');
    // Refresh repo list if creation modal is open
    if (!createModal.classList.contains('hidden')) {
      loadRepos();
    }
  });

  btnClearSettings.addEventListener('click', () => {
    tokenOverrideInput.value = '';
    localStorage.removeItem('github_token_override');
    alert('Token override cleared.');
    settingsPanel.classList.add('hidden');
    if (!createModal.classList.contains('hidden')) {
      loadRepos();
    }
  });

  // --- Sessions Functions ---
  async function loadSessions() {
    sessionsGrid.innerHTML = '';
    try {
      const res = await fetch('/api/sessions');
      if (res.status === 401) {
        showScreen('login');
        return;
      }
      
      const sessions = await res.json();
      if (sessions.length === 0) {
        sessionsGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
      }

      sessionsGrid.classList.remove('hidden');
      emptyState.classList.add('hidden');

      sessions.forEach(session => {
        const isRunning = session.status === 'running';
        const statusClass = isRunning ? 'running' : 'stopped';
        
        const card = document.createElement('div');
        card.className = 'glass-card session-card';
        card.innerHTML = `
          <div class="session-header">
            <div class="session-meta">
              <h4>${session.name}</h4>
              <a href="https://github.com/${session.repo}" target="_blank" class="repo-link">
                <i data-lucide="github" style="width: 14px; height: 14px;"></i>
                <span>${session.repo}</span>
              </a>
            </div>
            <div class="status-badge ${statusClass}">
              <span class="status-dot"></span>
              <span>${session.status}</span>
            </div>
          </div>
          <div class="session-footer">
            <span class="text-muted" style="font-size: 0.8rem;">Created: ${new Date(session.created * 1000).toLocaleDateString()}</span>
            <div class="session-actions">
              ${isRunning ? 
                `<button class="btn btn-secondary btn-sm btn-stop" data-name="${session.name}"><i data-lucide="square" style="width: 14px; height: 14px;"></i> Stop</button>` :
                `<button class="btn btn-primary btn-sm btn-start" data-name="${session.name}"><i data-lucide="play" style="width: 14px; height: 14px;"></i> Start</button>`
              }
              <button class="btn btn-danger btn-sm btn-delete" data-name="${session.name}"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Delete</button>
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
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.name));
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
    });
  });

  // --- Create Session Modal ---
  const openCreateModal = () => {
    createError.classList.add('hidden');
    sessionNameInput.value = '';
    repoManualInput.value = '';
    isManualRepoActive = false;
    manualRepoGroup.classList.add('hidden');
    repoSelect.classList.remove('hidden');
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
      repoSelect.classList.add('hidden');
      btnReloadRepos.classList.add('hidden');
      repoSelect.removeAttribute('required');
      repoManualInput.setAttribute('required', 'required');
      toggleManualRepo.textContent = 'Use repository list selection';
    } else {
      manualRepoGroup.classList.add('hidden');
      repoSelect.classList.remove('hidden');
      btnReloadRepos.classList.remove('hidden');
      repoSelect.setAttribute('required', 'required');
      repoManualInput.removeAttribute('required');
      toggleManualRepo.textContent = 'Or enter repository path manually';
    }
  });

  async function loadRepos() {
    repoSelect.innerHTML = '<option value="" disabled selected>Loading repositories...</option>';
    const overrideToken = localStorage.getItem('github_token_override') || '';
    
    let url = '/api/repos';
    if (overrideToken) {
      url += `?token=${encodeURIComponent(overrideToken)}`;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed response');
      }
      const repos = await res.json();
      
      repoSelect.innerHTML = '<option value="" disabled selected>Select a repository...</option>';
      repos.forEach(repo => {
        const opt = document.createElement('option');
        opt.value = repo.full_name;
        opt.textContent = `${repo.full_name} ${repo.private ? '(Private)' : ''}`;
        repoSelect.appendChild(opt);
      });
    } catch (err) {
      repoSelect.innerHTML = '<option value="" disabled selected>Failed to load repositories.</option>';
    }
  }

  btnReloadRepos.addEventListener('click', loadRepos);

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.classList.add('hidden');

    const name = sessionNameInput.value.trim();
    const repo = isManualRepoActive ? repoManualInput.value.trim() : repoSelect.value;
    const clientToken = localStorage.getItem('github_token_override') || '';

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
        body: JSON.stringify({ name, repo, clientToken })
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

  // --- Delete Session Modal ---
  function openDeleteModal(name) {
    activeDeleteSessionName = name;
    deleteSessionDisplay.textContent = name;
    deleteVolumeCheckbox.checked = true;
    deleteError.classList.add('hidden');
    deleteModal.classList.remove('hidden');
  }

  btnConfirmDelete.addEventListener('click', async () => {
    if (!activeDeleteSessionName) return;

    deleteError.classList.add('hidden');
    const deleteVolume = deleteVolumeCheckbox.checked;

    // Toggle loader
    const btnText = btnConfirmDelete.querySelector('span');
    const btnSpinner = btnConfirmDelete.querySelector('.spin');
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    btnConfirmDelete.setAttribute('disabled', 'disabled');

    try {
      const res = await fetch(`/api/sessions/${activeDeleteSessionName}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteVolume })
      });
      
      if (res.ok) {
        deleteModal.classList.add('hidden');
        loadSessions();
      } else {
        const data = await res.json();
        showError(deleteError, data.error || 'Failed to delete container session.');
      }
    } catch (err) {
      showError(deleteError, 'Network error. Failed to reach server.');
    } finally {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
      btnConfirmDelete.removeAttribute('disabled');
      activeDeleteSessionName = null;
    }
  });

  // --- Helper: Display Error ---
  function showError(element, message) {
    element.querySelector('.error-msg').textContent = message;
    element.classList.remove('hidden');
  }
});
