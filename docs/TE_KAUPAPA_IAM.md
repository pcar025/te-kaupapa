# Te Kaupapa staging developer IAM policy

## Purpose and attachment

`infra/iam/te-kaupapa-dev-policy.json` is the customer-managed policy for the manually created `te-kaupapa-dev` IAM user in AWS account `905418481310`. Its purpose is limited to Te Kaupapa Milestone 1 Cognito staging activation in `ap-southeast-2`.

Peter should attach exactly these two policies to that non-root identity:

1. Customer-managed policy named `TeKaupapaMilestone1StagingDeveloper`, using the repository JSON file.
2. AWS-managed policy `SignInLocalDevelopmentAccess`, attached separately for local-development login only.

The custom policy intentionally does not duplicate the AWS-managed login permissions.

After attachment, use:

```sh
aws login --profile te-kaupapa
aws sts get-caller-identity --profile te-kaupapa --region ap-southeast-2
```

Confirm the returned ARN identifies `te-kaupapa-dev` or its assumed session and **does not** end with `:root`. Do not print credentials or access keys.

## Policy design

The policy contains only these services:

- `sts`: `GetCallerIdentity` for the required preflight verification.
- `cloudformation`: validate, create, update, and inspect only `te-kaupapa-staging-*` stacks containing the three Cognito resource types in [the staging template](../infra/cognito-user-pool.yml).
- `cognito-idp`: create the tagged user pool, then configure, inspect, and roll back only tagged Te Kaupapa user pools; create/get/delete pilot users only in those pools.
- `ses`: read-only account/identity discovery to establish sandbox status and a suitable verified sender.

The template has no IAM resources or service role. `iam:PassRole` is not required and is not granted.

## Tag safeguards and resource scopes

Creation of a user pool must carry all four request tags:

- `Application=te-kaupapa`
- `Environment=staging`
- `ManagedBy=te-kaupapa-repository`
- `Purpose=authentication-pilot`

All existing-user-pool write, read, and pilot-user operations require those same resource tags on a Cognito user-pool ARN in account `905418481310`, region `ap-southeast-2`. The policy never grants Cognito writes to an untagged or other-product pool. CloudFormation stack operations are ARN-scoped to `te-kaupapa-staging-*`; stack updates/inspection also require the same stack tags and are restricted to the three Cognito resource types.

The policy deliberately does not grant `cognito-idp:TagResource` or `UntagResource`: the current template sends the required tags when it creates the user pool. If a future deployment produces a Cognito tagging permission failure, review the exact CloudFormation call before adding any tag action—do not broaden this policy pre-emptively.

## Unavoidable wildcards

The following permissions use `Resource: "*"`:

- `sts:GetCallerIdentity`: STS identity verification is not a resource-owned operation.
- `cloudformation:ValidateTemplate`: AWS does not provide a stack resource for validation of an undeployed local template.
- `cognito-idp:CreateUserPool`: the pool ARN does not exist until creation. Required request tags and the requested region constrain it.
- `cognito-idp:ListUserPools`, `ses:GetAccount`, and `ses:ListEmailIdentities`: these account/list APIs do not expose a resource type for IAM scoping. They are read-only and constrained to `ap-southeast-2`.

`ses:GetEmailIdentity` is scoped to identity ARNs in this account/region, but can read existing identity verification metadata. This is necessary to determine whether a demonstrably Te Kaupapa-owned sender exists; it grants no SES write or send capability. Read-only list/discovery can reveal metadata for other projects, including CareFlow, but grants no modification access.

## Deliberately excluded

The policy grants no IAM administration, no `iam:*`, no `iam:PassRole`, no RDS permissions, no Secrets Manager permissions, no SES identity/DNS/sending/production-access operations, no stack-set operations, and no broad service wildcards. It also excludes public signup, password/SMS configuration work, deployment hosting, and all Milestone 2 application capabilities.

It does not grant `cloudformation:DeleteStack`. CloudFormation may still need the narrowly scoped Cognito delete actions for automatic rollback of a failed stack operation. Deliberate stack teardown requires separate review/approval; the user pool has deletion protection enabled.

## CareFlow isolation and limits

CareFlow resources are never named in an allow statement. Positive stack-name, account, region, and tag scoping prevents writes to CareFlow or ambiguous resources. Cognito creation is the unavoidable exception: IAM cannot use a future pool ARN, so required request tags are enforced. CloudFormation stack creation is restricted by the Te Kaupapa stack ARN pattern and the exact resource types, but AWS does not expose a request-tag condition for `CreateStack`; the deployer must supply stack tags and review the change set/template before execution.

The policy cannot prove a Cognito domain prefix is available, an SES identity is independent of CareFlow, or that a caller's supplied template has not changed. Those remain required operator checks. Use only the repository-controlled template and stop if discovery identifies an ambiguous resource.

## Revocation and future approvals

When the pilot is complete, an account administrator should detach both policies from `te-kaupapa-dev`, deactivate/delete its access material according to the account process, and delete the IAM user only after confirming no approved Te Kaupapa task still uses it. These identity-management actions are intentionally outside this developer policy.

Separate approval is required before adding permissions for RDS/PostgreSQL, SES identity creation or modification, SES production access, Secrets Manager writes, production hosting/deployment, IAM changes, a CloudFormation service role, or any CareFlow integration.

## Source verification

This design follows AWS’s service authorization references for [CloudFormation](https://docs.aws.amazon.com/service-authorization/latest/reference/list_awscloudformation.html), [Cognito user pools](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncognitouserpools.html), and [SES v2](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html). Recheck those references and run IAM Access Analyzer validation in the target account before attachment because service condition-key support can change.
