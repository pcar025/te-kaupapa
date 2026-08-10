import { createRemoteJWKSet, jwtVerify } from 'jose'

import type { CognitoConfiguration } from '../config.js'

export interface ExternalIdentity {
  provider: 'cognito'
  subject: string
  email: string | undefined
  displayName: string | undefined
}

export interface OidcProvider {
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string
  exchangeCode(input: { code: string; codeVerifier: string; nonce: string; redirectUri: string }): Promise<ExternalIdentity>
}

export class CognitoOidcProvider implements OidcProvider {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>

  constructor(private readonly config: CognitoConfiguration) {
    this.jwks = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`))
  }

  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL('/oauth2/authorize', this.config.managedLoginDomain)
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: input.redirectUri,
      scope: 'openid email profile',
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    }).toString()
    return url.toString()
  }

  async exchangeCode(input: { code: string; codeVerifier: string; nonce: string; redirectUri: string }): Promise<ExternalIdentity> {
    const tokenUrl = new URL('/oauth2/token', this.config.managedLoginDomain)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    })
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
    if (this.config.clientSecret) {
      headers.authorization = `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`
    }
    const response = await fetch(tokenUrl, { method: 'POST', headers, body })
    if (!response.ok) throw new Error('Cognito token exchange was rejected.')
    const token = await response.json() as { id_token?: string }
    if (!token.id_token) throw new Error('Cognito did not return an ID token.')

    const verified = await jwtVerify(token.id_token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.clientId,
    })
    if (verified.payload.nonce !== input.nonce) throw new Error('OIDC nonce validation failed.')
    if (typeof verified.payload.sub !== 'string') throw new Error('Cognito ID token has no subject.')

    return {
      provider: 'cognito',
      subject: verified.payload.sub,
      email: typeof verified.payload.email === 'string' ? verified.payload.email : undefined,
      displayName: typeof verified.payload.name === 'string'
        ? verified.payload.name
        : typeof verified.payload.email === 'string' ? verified.payload.email : undefined,
    }
  }
}
