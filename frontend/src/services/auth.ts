const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

export interface SignupData {
  username: string;
  email: string;
  password: string;
}

export interface LoginData {
  email: string;
  password: string;
}

// Token management
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export const authService = {
  // Sign up
  signup: async (data: SignupData): Promise<AuthResponse> => {
    const response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to sign up';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    authService.setToken(result.access_token);
    authService.setUser(result.user);
    return result;
  },

  // Login
  login: async (data: LoginData): Promise<AuthResponse> => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to login';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    authService.setToken(result.access_token);
    authService.setUser(result.user);
    return result;
  },

  // Logout
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  // Token management
  getToken: (): string | null => {
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken: (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
  },

  // User management
  getUser: (): User | null => {
    const userStr = localStorage.getItem(USER_KEY);
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  },

  setUser: (user: User) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  // Check if user is authenticated
  isAuthenticated: (): boolean => {
    return !!authService.getToken();
  },

  // Get authorization header
  getAuthHeader: (): { Authorization: string } | {} => {
    const token = authService.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
};

