import { customFetch } from '@auth/core';

// ClassLink OneClick OAuth2: profile scope, server-side client_secret_post.
// https://github.com/classlinkinc/request-libraries/tree/master/classlink-oauth2
export default function ClassLink(options = {}) {
  const request = options[customFetch] ?? fetch;
  return {
    id: 'classlink',
    name: 'ClassLink',
    type: 'oauth',
    checks: ['state'],
    authorization: {
      url: 'https://launchpad.classlink.com/oauth2/v2/auth',
      params: { response_type: 'code', scope: 'profile' },
    },
    token: 'https://launchpad.classlink.com/oauth2/v2/token',
    client: { token_endpoint_auth_method: 'client_secret_post' },
    userinfo: {
      url: 'https://nodeapi.classlink.com/v2/my/info',
      async request({ tokens }) {
        const response = await request('https://nodeapi.classlink.com/v2/my/info', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          redirect: 'error',
        });
        if (!response.ok) throw new Error('ClassLink profile request failed');
        return response.json();
      },
    },
    profile(user) {
      const id = value => {
        if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
          throw new Error('Invalid ClassLink identity');
        }
        if (!['string', 'number'].includes(typeof value) || !/^(0|[1-9][0-9]{0,19})$/.test(String(value))) {
          throw new Error('Missing ClassLink identity');
        }
        return String(value);
      };
      return {
        // Namespace by district; never identify or link a student by display name/email.
        id: `${id(user.TenantId)}:${id(user.UserId)}`,
        name: user.DisplayName || [user.FirstName, user.LastName].filter(Boolean).join(' ') || 'ClassLink user',
        email: typeof user.Email === 'string' && user.Email ? user.Email : null,
        image: null,
      };
    },
    options,
  };
}
