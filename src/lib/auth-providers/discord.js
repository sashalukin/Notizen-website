import Discord from 'next-auth/providers/discord';

// Confidential-client authorization-code flow: state stays in the originating
// WebView; only the server redeems the code using its client secret.
export default function DiscordLogin(options) {
  return Discord({
    ...options,
    checks: ['state'],
    client: { token_endpoint_auth_method: 'client_secret_basic' },
    authorization: { params: { scope: 'identify' } },
  });
}
