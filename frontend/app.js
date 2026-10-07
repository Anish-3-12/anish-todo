// Configuration
const API_BASE_URL = window.API_BASE_URL || 'http://localhost:8000';
const KEYCLOAK_BASE_URL = window.KEYCLOAK_BASE_URL || 'http://localhost:8080';
const REALM = 'todo-realm';
const CLIENT_ID = 'todo-frontend';

// DOM Elements - Auth
const authCard = document.getElementById('auth-card');
const loginPanel = document.getElementById('login-panel');
const userInfoPanel = document.getElementById('user-info-panel');
const loginForm = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const keycloakRedirectBtn = document.getElementById('keycloak-redirect-btn');
const logoutBtn = document.getElementById('logout-btn');
const currentUsernameSpan = document.getElementById('current-username');
const currentUserSubSpan = document.getElementById('current-user-sub');

// DOM Elements - App Content
const appContent = document.getElementById('app-content');
const todoList = document.getElementById('todo-list');
const loadingState = document.getElementById('loading');
const emptyState = document.getElementById('empty-state');
const createForm = document.getElementById('create-todo-form');
const titleInput = document.getElementById('todo-title');
const descriptionInput = document.getElementById('todo-description');
const refreshBtn = document.getElementById('refresh-btn');
const notification = document.getElementById('notification');

// DOM Elements - Edit Modal
const editModal = document.getElementById('edit-modal');
const modalOverlay = document.getElementById('modal-overlay');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const editForm = document.getElementById('edit-todo-form');
const editIdInput = document.getElementById('edit-todo-id');
const editTitleInput = document.getElementById('edit-todo-title');
const editDescInput = document.getElementById('edit-todo-description');
const editCompletedInput = document.getElementById('edit-todo-completed');

let notificationTimeout = null;

function showNotification(message, type = 'success') {
  if (notificationTimeout) clearTimeout(notificationTimeout);
  notification.textContent = message;
  notification.className = `notification ${type}`;
  notificationTimeout = setTimeout(() => {
    notification.className = 'notification hidden';
  }, 3500);
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString();
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (err) {
    return null;
  }
}

// Auth State Helpers
function getToken() {
  return localStorage.getItem('auth_token');
}

function setAuth(token) {
  const payload = parseJwt(token);
  if (!payload) {
    throw new Error('Invalid token format');
  }
  localStorage.setItem('auth_token', token);
  localStorage.setItem(
    'auth_user',
    JSON.stringify({
      username: payload.preferred_username || payload.sub,
      userId: payload.sub,
    })
  );
  updateAuthUI();
}

function clearAuth() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  updateAuthUI();
}

function updateAuthUI() {
  const token = getToken();
  if (token) {
    const userStr = localStorage.getItem('auth_user');
    const user = userStr ? JSON.parse(userStr) : {};

    currentUsernameSpan.textContent = user.username || 'User';
    currentUserSubSpan.textContent = `ID: ${user.userId || ''}`;

    loginPanel.classList.add('hidden');
    userInfoPanel.classList.remove('hidden');
    appContent.classList.remove('hidden');
  } else {
    loginPanel.classList.remove('hidden');
    userInfoPanel.classList.add('hidden');
    appContent.classList.add('hidden');
    todoList.innerHTML = '';
  }
}

// Authenticated fetch wrapper
async function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) {
    clearAuth();
    throw new Error('Not authenticated. Please log in.');
  }

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 || response.status === 403) {
    clearAuth();
    showNotification('Session expired or unauthorized. Please log in again.', 'error');
    throw new Error('Unauthorized');
  }
  return response;
}

// 1. Keycloak Login (Direct Access Grant)
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;

  if (!username || !password) return;

  try {
    showNotification('Authenticating with Keycloak...', 'success');

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      username,
      password,
    });

    const res = await fetch(
      `${KEYCLOAK_BASE_URL}/realms/${REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }
    );

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error_description || 'Invalid credentials or login failed');
    }

    const data = await res.json();
    setAuth(data.access_token);
    showNotification(`Welcome, ${username}!`);
    await fetchTodos();
  } catch (err) {
    showNotification(err.message, 'error');
  }
});

// Keycloak Hosted Page Redirect Login
keycloakRedirectBtn.addEventListener('click', () => {
  const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
  const authUrl = `${KEYCLOAK_BASE_URL}/realms/${REALM}/protocol/openid-connect/auth?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${redirectUri}&scope=openid`;
  window.location.href = authUrl;
});

// Logout
logoutBtn.addEventListener('click', () => {
  clearAuth();
  showNotification('Logged out successfully.');
});

// Check if returning from Keycloak redirect (token in URL hash)
function checkUrlHashToken() {
  if (window.location.hash) {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const token = params.get('access_token');
    if (token) {
      try {
        setAuth(token);
        // Clean URL hash
        window.history.replaceState(null, '', window.location.pathname);
        showNotification('Successfully logged in via Keycloak!');
        return true;
      } catch (err) {
        showNotification('Failed to process authentication token', 'error');
      }
    }
  }
  return false;
}

// 2. GET /todos - Fetch user's todos
async function fetchTodos() {
  if (!getToken()) return;

  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  todoList.innerHTML = '';

  try {
    const res = await authFetch(`${API_BASE_URL}/todos`);
    if (!res.ok) {
      throw new Error(`Failed to load todos (HTTP ${res.status})`);
    }
    const todos = await res.json();
    loadingState.classList.add('hidden');

    if (todos.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }

    todos.forEach((todo) => {
      const li = document.createElement('li');
      li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
      li.dataset.id = todo.id;

      li.innerHTML = `
        <div class="todo-item-left">
          <input
            type="checkbox"
            class="todo-checkbox"
            ${todo.completed ? 'checked' : ''}
            title="Toggle completed"
          />
          <div class="todo-details">
            <div>
              <span class="todo-title">${escapeHtml(todo.title)}</span>
              <span class="badge ${todo.completed ? 'badge-completed' : 'badge-pending'}">
                ${todo.completed ? 'Completed' : 'Pending'}
              </span>
            </div>
            ${
              todo.description
                ? `<div class="todo-description">${escapeHtml(todo.description)}</div>`
                : ''
            }
            <div class="todo-meta">
              Created: ${formatDate(todo.created_at)}
              ${
                todo.updated_at && todo.updated_at !== todo.created_at
                  ? ` | Updated: ${formatDate(todo.updated_at)}`
                  : ''
              }
            </div>
          </div>
        </div>
        <div class="todo-item-actions">
          <button class="btn btn-secondary btn-sm edit-btn">Edit</button>
          <button class="btn btn-danger btn-sm delete-btn">Delete</button>
        </div>
      `;

      // Checkbox listener
      const checkbox = li.querySelector('.todo-checkbox');
      checkbox.addEventListener('change', () => toggleCompleted(todo.id, checkbox.checked));

      // Edit button listener
      const editBtn = li.querySelector('.edit-btn');
      editBtn.addEventListener('click', () => openEditModal(todo.id));

      // Delete button listener
      const deleteBtn = li.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', () => deleteTodo(todo.id, todo.title));

      todoList.appendChild(li);
    });
  } catch (err) {
    loadingState.classList.add('hidden');
    if (err.message !== 'Unauthorized') {
      showNotification(err.message, 'error');
    }
  }
}

// 3. POST /todos - Create a new todo
createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  const description = descriptionInput.value.trim();

  if (!title) return;

  try {
    const res = await authFetch(`${API_BASE_URL}/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: description || null,
        completed: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to create todo (HTTP ${res.status})`);
    }

    titleInput.value = '';
    descriptionInput.value = '';
    showNotification('Todo created successfully!');
    await fetchTodos();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showNotification(err.message, 'error');
    }
  }
});

// 4. PUT /todos/{id} - Quick toggle completion
async function toggleCompleted(id, completed) {
  try {
    const res = await authFetch(`${API_BASE_URL}/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });

    if (!res.ok) {
      throw new Error(`Failed to update status (HTTP ${res.status})`);
    }

    showNotification(completed ? 'Todo marked as completed!' : 'Todo marked as pending.');
    await fetchTodos();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showNotification(err.message, 'error');
    }
    await fetchTodos();
  }
}

// 5. GET /todos/{id} - Retrieve single todo & open modal
async function openEditModal(id) {
  try {
    const res = await authFetch(`${API_BASE_URL}/todos/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch todo details (HTTP ${res.status})`);
    }
    const todo = await res.json();

    editIdInput.value = todo.id;
    editTitleInput.value = todo.title;
    editDescInput.value = todo.description || '';
    editCompletedInput.checked = Boolean(todo.completed);

    editModal.classList.remove('hidden');
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showNotification(err.message, 'error');
    }
  }
}

function closeEditModal() {
  editModal.classList.add('hidden');
  editForm.reset();
}

closeModalBtn.addEventListener('click', closeEditModal);
cancelEditBtn.addEventListener('click', closeEditModal);
modalOverlay.addEventListener('click', closeEditModal);

// 6. PUT /todos/{id} - Save edited todo
editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = editIdInput.value;
  const title = editTitleInput.value.trim();
  const description = editDescInput.value.trim();
  const completed = editCompletedInput.checked;

  if (!title) return;

  try {
    const res = await authFetch(`${API_BASE_URL}/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: description || null,
        completed,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to update todo (HTTP ${res.status})`);
    }

    closeEditModal();
    showNotification('Todo updated successfully!');
    await fetchTodos();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showNotification(err.message, 'error');
    }
  }
});

// 7. DELETE /todos/{id} - Enqueue delete job via Redis
async function deleteTodo(id, title) {
  if (!confirm(`Are you sure you want to delete "${title}"?`)) {
    return;
  }

  try {
    const res = await authFetch(`${API_BASE_URL}/todos/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      throw new Error(`Failed to delete todo (HTTP ${res.status})`);
    }

    showNotification('Delete job queued. Removing todo...');
    setTimeout(fetchTodos, 350);
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showNotification(err.message, 'error');
    }
  }
}

refreshBtn.addEventListener('click', fetchTodos);

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  checkUrlHashToken();
  updateAuthUI();
  if (getToken()) {
    fetchTodos();
  }
});
