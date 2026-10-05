import { customFetch } from '@auth/core';

// Clever's documented OAuth authorization-code flow uses state and HTTP Basic
// client authentication. Do not assume Google/OIDC PKCE behavior for this provider.
export default function Clever(options = {}) {
  const request = options[customFetch] ?? fetch;
  const { districtId, ...config } = options;
  return {
    id: 'clever',
    name: 'Clever',
    type: 'oauth',
    checks: ['state'],
    authorization: {
      url: 'https://clever.com/oauth/authorize',
      // Scopes are assigned to the Clever app; suppress Auth.js's default OIDC scopes.
      params: { response_type: 'code', scope: '', ...(districtId ? { district_id: districtId } : {}) },
    },
    token: 'https://clever.com/oauth/tokens',
    client: { token_endpoint_auth_method: 'client_secret_basic' },
    userinfo: {
      url: 'https://api.clever.com/v3.0/me',
      async request({ tokens }) {
        async function read(path) {
          const response = await request(`https://api.clever.com/v3.0/${path}`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
            redirect: 'error',
          });
          if (!response.ok) throw new Error('Clever profile request failed');
          return response.json();
        }
        const me = await read('me');
        const id = me?.data?.id;
        if (me?.type !== 'user' || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
          throw new Error('Clever did not identify a user');
        }
        const user = await read(`users/${encodeURIComponent(id)}`);
        if (user?.data?.id !== id) throw new Error('Clever user identity mismatch');
        return user.data;
      },
    },
    profile(user) {
      return {
        id: user.id,
        name: [user.name?.first, user.name?.last].filter(Boolean).join(' ') || 'Clever user',
        email: user.email || null,
        image: null,
      };
    },
    // Keep Auth.js's default protection against linking accounts by unverified email.
    options: config,
  };
}
