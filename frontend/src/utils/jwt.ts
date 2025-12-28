/**
 * Decode JWT token to extract payload
 * Note: This is a simple base64 decode, not a full JWT verification
 * For production, you should verify the token signature
 */
export function decodeJWT(token: string): any | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

/**
 * Extract userId from JWT token
 */
export function getUserIdFromToken(): string | null {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  
  const payload = decodeJWT(token);
  if (!payload) return null;
  
  // JWT typically uses 'sub' for the subject (user ID)
  return payload.sub || payload.userId || payload.id || null;
}

