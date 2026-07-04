document.addEventListener('DOMContentLoaded', () => {
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
  const deleteVolumeCheckbox = document.getElementById('delete-volume-checkbox');
  const deleteError = document.getElementById('delete-error');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete');

  // State
  let activeDeleteSessionName = null;
  let isManualRepoActive = false;
  let repositories = [];

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
      showScreen('login');
    } catch (e) {
      showScreen('login');
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
        <span>${repo.full_name}</span>
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
