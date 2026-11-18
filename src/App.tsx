
import { useState, useEffect, useRef, type FormEvent } from 'react';
import './App.css';

const API = 'https://inai-col3.fishrungames.com/api';
const CHAT_URL = 'wss://inai-col3.fishrungames.com/chat/';

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

interface AuthResponse {
  access: string;
  user: {
    id: number;
    username: string;
  };
}

interface ChatMessage {
  sender: string;
  text: string;
  timestamp: number;
}

async function readResponse(response: Response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Server returned an invalid response.');
  }
}

// Обновление Access Token
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API}/token/refresh/`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        accessToken = null;
        return null;
      }

      const data = await readResponse(response);
      accessToken = data.access || null;

      return accessToken;
    } catch {
      accessToken = null;
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// Общая функция API-запросов
async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const makeRequest = () => {
    const headers = new Headers(options.headers);

    headers.set('Accept', 'application/json');

    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    return fetch(`${API}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  };

  let response = await makeRequest();

  if (response.status === 401) {
    const token = await refreshAccessToken();

    if (token) {
      response = await makeRequest();
    }
  }

  return response;
}

// Регистрация
async function register(
  username: string,
  password: string
): Promise<AuthResponse> {
  const response = await fetch(`${API}/register/`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      data.detail || JSON.stringify(data) || 'Registration failed'
    );
  }

  accessToken = data.access;

  return data;
}

// Вход
async function login(
  username: string,
  password: string
): Promise<AuthResponse> {
  const response = await fetch(`${API}/login/`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      data.detail || JSON.stringify(data) || 'Login failed'
    );
  }

  accessToken = data.access;

  return data;
}

// Выход
async function logout() {
  try {
    const response = await apiFetch('/logout/', {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Could not sign out');
    }
  } finally {
    accessToken = null;
  }
}

function App() {
  const [isRegister, setIsRegister] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState('');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');

  const [socketStatus, setSocketStatus] = useState('Disconnected');
  const [chatAuthorized, setChatAuthorized] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);

  // Подключение к групповому чату
  function connectWebSocket() {
    if (!accessToken) {
      setSocketStatus('No access token');
      return;
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setSocketStatus('Connecting...');
    setChatAuthorized(false);

    const socket = new WebSocket(CHAT_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;

      setSocketStatus('Authenticating...');

      // Первое сообщение обязательно AUTH
      socket.send(
        JSON.stringify({
          type: 'AUTH',
          payload: {
            token: accessToken,
          },
        })
      );
    };

    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;

      try {
        const data = JSON.parse(event.data);

        // Успешная авторизация
        if (data.type === 'AUTH_SUCCESS') {
          setChatAuthorized(true);
          setSocketStatus('Connected');
        }

        // Новое сообщение
        if (data.type === 'NEW_MESSAGE') {
          const incoming = data.payload;

          if (
            typeof incoming?.sender === 'string' &&
            typeof incoming?.text === 'string'
          ) {
            setChatMessages((previous) => [
              ...previous,
              {
                sender: incoming.sender,
                text: incoming.text,
                timestamp:
                  typeof incoming.timestamp === 'number'
                    ? incoming.timestamp
                    : Date.now(),
              },
            ]);
          }
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    socket.onerror = () => {
      if (socketRef.current !== socket) return;

      setSocketStatus('Connection error');
      setChatAuthorized(false);
    };

    socket.onclose = () => {
      if (socketRef.current !== socket) return;

      setSocketStatus('Disconnected');
      setChatAuthorized(false);
    };
  }

  // Отправка сообщения
  function handleSendMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const text = chatText.trim();
    const socket = socketRef.current;

    if (!text) return;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !chatAuthorized
    ) {
      setSocketStatus('Not connected');
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'CHAT_MESSAGE',
        payload: { text },
      })
    );

    setChatText('');
  }

  // Регистрация и вход
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setLoading(true);
    setMessage('');

    try {
      const data = isRegister
        ? await register(username, password)
        : await login(username, password);

      if (!data.access || !data.user?.username) {
        throw new Error('Server did not return the required user data.');
      }

      setCurrentUser(data.user.username);
      setUsername(data.user.username);
      setPassword('');
      setLoggedIn(true);

      setMessage(
        isRegister
          ? 'Account successfully created!'
          : 'Welcome back!'
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Connection error'
      );
    } finally {
      setLoading(false);
    }
  }

  // Восстановление сессии после обновления страницы
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = await refreshAccessToken();

      if (!token || cancelled) return;

      try {
        const response = await apiFetch('/profile/');

        if (!response.ok) {
          accessToken = null;
          return;
        }

        const data = await readResponse(response);

        if (cancelled) return;

        if (!data.username) {
          accessToken = null;
          return;
        }

        setCurrentUser(data.username);
        setUsername(data.username);
        setLoggedIn(true);
      } catch (error) {
        console.error('Session restoration error:', error);
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  // Подключение WebSocket после входа
  useEffect(() => {
    if (loggedIn && accessToken) {
      connectWebSocket();
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }

      setChatAuthorized(false);
    };
  }, [loggedIn]);

  // Logout
  async function handleLogout() {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setChatAuthorized(false);
    setSocketStatus('Disconnected');
    setChatMessages([]);
    setChatText('');

    try {
      await logout();

      setLoggedIn(false);
      setCurrentUser('');
      setUsername('');
      setPassword('');
      setMessage('You have signed out.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Logout error'
      );
    } finally {
      setLoggedIn(false);
      setCurrentUser('');
    }
  }

  // Интерфейс чата
  if (loggedIn) {
    return (
      <main className="page">
        <header className="navbar">
          <a className="logo" href="#">
            <span className="logo-icon">GC</span>
            GroupChat
          </a>

          <div className="user-info">
            <span>{currentUser}</span>
            <button
              className="logout-button"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </header>

        <section className="chat-container">
          <div className="chat-header">
            <div>
              <span className="eyebrow">COMMUNITY CHAT</span>
              <h1>Group conversation</h1>
              <p>Connect and communicate in real time.</p>
            </div>

            <div className="connection">
              <span
                className={
                  chatAuthorized ? 'status-dot online' : 'status-dot'
                }
              />
              {socketStatus}
            </div>
          </div>

          <div className="chat-messages">
            {chatMessages.length === 0 ? (
              <div className="chat-empty">
                <div className="empty-icon">✉</div>
                <h3>No messages yet</h3>
                <p>Be the first to start a conversation!</p>
              </div>
            ) : (
              chatMessages.map((item, index) => (
                <div
                  className={
                    item.sender === currentUser
                      ? 'message own-message'
                      : 'message'
                  }
                  key={`${item.timestamp}-${index}`}
                >
                  <div className="message-header">
                    <strong>{item.sender}</strong>
                    <span>
                      {new Date(
                        item.timestamp < 1000000000000
                          ? item.timestamp * 1000
                          : item.timestamp
                      ).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <p>{item.text}</p>
                </div>
              ))
            )}
          </div>

          <form className="chat-form" onSubmit={handleSendMessage}>
            <input
              type="text"
              placeholder={
                chatAuthorized
                  ? 'Write a message...'
                  : 'Waiting for authorization...'
              }
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              disabled={!chatAuthorized}
            />

            <button
              type="submit"
              disabled={!chatAuthorized || !chatText.trim()}
            >
              Send →
            </button>
          </form>

          {!chatAuthorized && (
            <p className="chat-hint">
              You can send messages after successful authorization.
            </p>
          )}
        </section>

        <footer>
          <span>© 2026 GroupChat</span>
          <span>Built for communication ♡</span>
        </footer>
      </main>
    );
  }

  // Интерфейс регистрации и входа
  return (
    <main className="page">
      <header className="navbar">
        <a className="logo" href="#">
          <span className="logo-icon">GC</span>
          GroupChat
        </a>

        <span className="nav-label">REAL-TIME COMMUNITY</span>
      </header>

      <section className="hero">
        <div className="hero-content">
          <span className="eyebrow">✦ CONNECT WITH EVERYONE</span>

          <h1>
            One chat.
            <br />
            <span>Many voices.</span>
          </h1>

          <p>
            A simple place to communicate, share ideas and
            connect with people in real time.
          </p>

          <div className="features">
            <div>✦ <span>Real-time messaging</span></div>
            <div>◎ <span>JWT authentication</span></div>
            <div>↗ <span>Group communication</span></div>
          </div>
        </div>

        <div className="auth-card">
          <div className="card-icon">GC</div>

          <h2>{isRegister ? 'Create account' : 'Welcome back'}</h2>

          <p className="card-description">
            {isRegister
              ? 'Join the GroupChat community.'
              : 'Sign in to continue to your chat.'}
          </p>

          <div className="auth-tabs">
            <button
              type="button"
              className={!isRegister ? 'active' : ''}
              onClick={() => {
                setIsRegister(false);
                setMessage('');
              }}
            >
              Login
            </button>

            <button
              type="button"
              className={isRegister ? 'active' : ''}
              onClick={() => {
                setIsRegister(true);
                setMessage('');
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <label>Username</label>

            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />

            <label>Password</label>

            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <button type="submit" disabled={loading}>
              {loading
                ? 'Please wait...'
                : isRegister
                  ? 'Create account →'
                  : 'Sign in →'}
            </button>
          </form>

          {message && <p className="form-message">{message}</p>}
        </div>
      </section>

      <footer>
        <span>© 2026 GroupChat</span>
        <span>Made for everyone ♡</span>
      </footer>
    </main>
  );
}

export default App;

