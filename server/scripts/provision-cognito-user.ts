import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { createDatabaseConnection } from '../db/repository.js'
import { appUsers, externalIdentities, organisations, roleAssignments, supervision } from '../db/schema.js'

const argumentsSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  organisationSlug: z.string().regex(/^[a-z0-9-]+$/),
  organisationName: z.string().min(1),
  roles: z.array(z.enum(['KAIMAHI', 'SUPERVISOR'])).min(1),
  supervisesUserIds: z.array(z.string().uuid()),
  dryRun: z.boolean(),
})

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function parseArguments() {
  return argumentsSchema.parse({
    email: option('email')?.toLowerCase(),
    displayName: option('display-name'),
    organisationSlug: option('organisation-slug'),
    organisationName: option('organisation-name'),
    roles: option('roles')?.split(',').map((role) => role.trim()),
    supervisesUserIds: option('supervises-user-ids')?.split(',').filter(Boolean) ?? [],
    dryRun: process.argv.includes('--dry-run'),
  })
}

function subjectFromAttributes(attributes: { Name?: string; Value?: string }[] | undefined): string | undefined {
  return attributes?.find((attribute) => attribute.Name === 'sub')?.Value
}

async function findOrCreateCognitoUser(input: { email: string; displayName: string }): Promise<string> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  const region = process.env.AWS_REGION
  if (!userPoolId || !region) throw new Error('COGNITO_USER_POOL_ID and AWS_REGION are required for provisioning.')
  const client = new CognitoIdentityProviderClient({ region })
  try {
    const created = await client.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: input.email,
      // Omit TemporaryPassword: this is a confirmed passwordless user when email OTP is enabled.
      DesiredDeliveryMediums: ['EMAIL'],
      UserAttributes: [
        { Name: 'email', Value: input.email },
        { Name: 'name', Value: input.displayName },
      ],
    }))
    const subject = subjectFromAttributes(created.User?.Attributes)
    if (!subject) throw new Error('Cognito did not return a subject for the new user.')
    return subject
  } catch (error) {
    if (!(error instanceof UsernameExistsException)) throw error
    const existing = await client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: input.email }))
    const subject = subjectFromAttributes(existing.UserAttributes)
    if (!subject) throw new Error('The existing Cognito user has no subject.')
    return subject
  }
}

async function main() {
  const input = parseArguments()
  if (input.supervisesUserIds.length > 0 && !input.roles.includes('SUPERVISOR')) {
    throw new Error('A supervision assignment requires the SUPERVISOR role.')
  }
  if (input.dryRun) {
    console.log('Provisioning input is valid. No database or AWS changes were made.')
    return
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for provisioning.')
  const subject = await findOrCreateCognitoUser(input)
  const connection = createDatabaseConnection(databaseUrl)
  try {
    await connection.db.transaction(async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({ slug: input.organisationSlug, name: input.organisationName })
        .onConflictDoUpdate({ target: organisations.slug, set: { name: input.organisationName } })
        .returning()

      const [user] = await tx
        .insert(appUsers)
        .values({ organisationId: organisation.id, email: input.email, displayName: input.displayName })
        .onConflictDoUpdate({
          target: [appUsers.organisationId, appUsers.email],
          set: { displayName: input.displayName, updatedAt: new Date() },
        })
        .returning()

      for (const role of input.roles) {
        await tx.insert(roleAssignments).values({ userId: user.id, role }).onConflictDoNothing()
      }
      const [existingIdentity] = await tx
        .select({ userId: externalIdentities.userId })
        .from(externalIdentities)
        .where(and(eq(externalIdentities.provider, 'cognito'), eq(externalIdentities.providerSubject, subject)))
        .limit(1)
      if (existingIdentity && existingIdentity.userId !== user.id) {
        throw new Error('This Cognito identity is already linked to a different Te Kaupapa user.')
      }
      if (!existingIdentity) {
        await tx.insert(externalIdentities).values({ userId: user.id, provider: 'cognito', providerSubject: subject })
      }
      for (const kaimahiUserId of input.supervisesUserIds) {
        await tx.insert(supervision).values({
          organisationId: organisation.id,
          supervisorUserId: user.id,
          kaimahiUserId,
        }).onConflictDoNothing()
      }
    })
    console.log('Cognito user and Te Kaupapa authorization record are provisioned.')
  } finally {
    await connection.close()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Provisioning failed.')
  process.exitCode = 1
})
