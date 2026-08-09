# Te Kaupapa staging developer IAM policies

## Purpose and attachment

The Milestone 1 policy is split because AWS customer-managed policies have a 6,144 non-whitespace-character limit. Attach the two replacement policies to the manually created `te-kaupapa-dev` IAM user in AWS account `905418481310`; their purpose is limited to Te Kaupapa Milestone 1 Cognito staging activation in `ap-southeast-2`.

Peter should attach exactly these three policies to that non-root identity:

1. AWS-managed policy `SignInLocalDevelopmentAccess`, attached separately for local-development login only.
2. Customer-managed `TeKaupapaMilestone1CloudFormation`, using [te-kaupapa-m1-cloudformation-policy.json](../infra/iam/te-kaupapa-m1-cloudformation-policy.json).
3. Customer-managed `TeKaupapaMilestone1CognitoSes`, using [te-kaupapa-m1-cognito-ses-policy.json](../infra/iam/te-kaupapa-m1-cognito-ses-policy.json).

The replacement policies intentionally do not duplicate the AWS-managed login permissions. The former [te-kaupapa-dev-policy.json](../infra/iam/te-kaupapa-dev-policy.json) remains as the documented source policy, but is **superseded for AWS attachment** because its 6,390 non-whitespace characters exceed AWS's limit. Do not delete it. Detach the former `TeKaupapaMilestone1StagingDeveloper` only after both replacement policies have been created and attached successfully; retain the old policy unattached for audit/history.

After attachment, use:

```sh
aws login --profile te-kaupapa
aws sts get-caller-identity --profile te-kaupapa --region ap-southeast-2
```

Confirm the returned ARN identifies `te-kaupapa-dev` or its assumed session and **does not** end with `:root`. Do not print credentials or access keys.

## Policy design

`TeKaupapaMilestone1CloudFormation` contains only:

- `sts`: `GetCallerIdentity` for the required preflight verification.
- `cloudformation`: validate, create, update, and inspect only `te-kaupapa-staging-*` stacks containing the three Cognito resource types in [the staging template](../infra/cognito-user-pool.yml). It may delete only tagged instances of the fixed canonical `te-kaupapa-staging-authentication` stack name, after their resources are confirmed safe for the approved cleanup.
- `cloudformation`: additionally create, inspect, and delete one named change set only for the already-successful canonical authentication stack. This is limited to the approved passkey RP-ID review, the fixed resource types, the four required request/resource tags, and change-set name `te-kaupapa-passkey-rpid-20260809`; it cannot inspect or execute a change set for another stack.

`TeKaupapaMilestone1CognitoSes` contains only:

- `iam`: one `CreateServiceLinkedRole` exception, constrained to Cognito's `email.cognito-idp.amazonaws.com` service principal so Cognito can create its own SES email-delivery service-linked role when absent.
- `cognito-idp`: create and apply the four required tags to the new user pool, then configure (including the template's explicit MFA-off setting), inspect (including its bounded user inventory and effective MFA/WebAuthn configuration), and roll back only tagged Te Kaupapa user pools; create/get/delete pilot users only in those pools. It also permits read-only availability checking for the one requested Cognito domain prefix.
- `ses`: read-only account/identity discovery to establish sandbox status and a suitable verified sender.

The template has no IAM resources or service role. `iam:PassRole` is not required and is not granted.

## Tag safeguards and resource scopes

Creation of a user pool must carry all four request tags:

- `Application=te-kaupapa`
- `Environment=staging`
- `ManagedBy=te-kaupapa-repository`
- `Purpose=authentication-pilot`

All existing-user-pool write, read, and pilot-user operations in `TeKaupapaMilestone1CognitoSes` require those same resource tags on a Cognito user-pool ARN in account `905418481310`, region `ap-southeast-2`. The policy never grants Cognito writes to an untagged or other-product pool. CloudFormation operations in `TeKaupapaMilestone1CloudFormation` are ARN-scoped to `te-kaupapa-staging-*`; stack updates/inspection also require the same stack tags and are restricted to the three Cognito resource types.

CloudFormation propagates stack-level and system tags to Cognito user pools. The policy permits `cognito-idp:TagResource` only when the request includes the four required Te Kaupapa tag values and when every tag key is either one of those four keys or an `aws:cloudformation:*` system key. It permits `cognito-idp:UntagResource` only for those CloudFormation system keys, not for Te Kaupapa ownership tags. This is necessary because a new user pool has no resource tags until that call completes, and Cognito documents all of `TagResource`, `UntagResource`, and `ListTagsForResource` as CloudFormation tagging prerequisites.

## Unavoidable wildcards

The following permissions use `Resource: "*"`:

- `sts:GetCallerIdentity` in `TeKaupapaMilestone1CloudFormation`: STS identity verification is not a resource-owned operation.
- `cloudformation:ValidateTemplate` in `TeKaupapaMilestone1CloudFormation`: AWS does not provide a stack resource for validation of an undeployed local template.
- `cognito-idp:CreateUserPool` in `TeKaupapaMilestone1CognitoSes`: the pool ARN does not exist until creation. Required request tags and the requested region constrain it.
- `iam:CreateServiceLinkedRole` in `TeKaupapaMilestone1CognitoSes`: the service-linked role does not exist before Cognito creates it. AWS requires `Resource: "*"` for this creation flow; `iam:AWSServiceName=email.cognito-idp.amazonaws.com` limits it to Cognito's SES email-delivery role.
- `cognito-idp:ListUserPools`, `cognito-idp:DescribeUserPoolDomain`, `ses:GetAccount`, and `ses:ListEmailIdentities` in `TeKaupapaMilestone1CognitoSes`: these discovery APIs do not expose a resource type that can safely express an as-yet-uncreated pool/domain. They are read-only and constrained to `ap-southeast-2`; the operational procedure limits the domain query to the approved Te Kaupapa prefix.

`ses:GetEmailIdentity` is scoped to identity ARNs in this account/region, but can read existing identity verification metadata. This is necessary to determine whether a demonstrably Te Kaupapa-owned sender exists; it grants no SES write or send capability. Read-only list/discovery can reveal metadata for other projects, including CareFlow, but grants no modification access.

## Deliberately excluded

Neither replacement policy grants IAM administration, `iam:*`, `iam:PassRole`, RDS permissions, Secrets Manager permissions, SES identity/DNS/sending/production-access operations, stack-set operations, or broad service wildcards. The sole exception is the exact `iam:CreateServiceLinkedRole` action required by Cognito email configuration, constrained to `email.cognito-idp.amazonaws.com`; it cannot create a role for another service or modify/delete/attach any role. They also exclude public signup, password/SMS configuration work, deployment hosting, and all Milestone 2 application capabilities.

It grants `cloudformation:DeleteStack` only for the fixed canonical stack path `te-kaupapa-staging-authentication/*`, in this account and region, and only while the stack has all four required Te Kaupapa resource tags. CloudFormation generates a new stack ID on each retry, so this stack-name scope avoids accumulating per-ID cleanup exceptions while still excluding every other stack name, including CareFlow. A separate read-only `DescribeStacks` statement is scoped to the same canonical path without a resource-tag condition so a deletion waiter can verify removal after CloudFormation no longer exposes the stack's tags. It does not permit deletion of `te-kaupapa-staging-authentication-v2`, a successful stack under another name, any non-Te-Kaupapa stack, or any arbitrary future name. CloudFormation may still need the narrowly scoped Cognito delete actions for automatic rollback of a failed stack operation. Deliberate teardown of a successful user pool remains a separate review/approval decision; the user pool has deletion protection enabled.

The one passkey change-set exception is narrower still: `CreateChangeSet`, `DescribeChangeSet`, and `DeleteChangeSet` apply only to stack ID `29a3c780-93e1-11f1-936a-02407fbd357b` and the fixed name `te-kaupapa-passkey-rpid-20260809`. It authorizes preview and cleanup of the exact approved update, not `ExecuteChangeSet`; the already-scoped `UpdateStack` action remains the separately controlled operation that can apply an approved reviewed template. AWS documents these change-set actions as stack-scoped and supports the resource-type, change-set-name, and request-tag conditions used here.

## CareFlow isolation and limits

CareFlow resources are never named in an allow statement. Positive stack-name, account, region, and tag scoping prevents writes to CareFlow or ambiguous resources. Cognito creation is the unavoidable exception: IAM cannot use a future pool ARN, so required request tags are enforced. CloudFormation stack creation is restricted by the Te Kaupapa stack ARN pattern and the exact resource types, but AWS does not expose a request-tag condition for `CreateStack`; the deployer must supply stack tags and review the change set/template before execution.

The policy cannot prove a Cognito domain prefix is available, an SES identity is independent of CareFlow, or that a caller's supplied template has not changed. Those remain required operator checks. Use only the repository-controlled template and stop if discovery identifies an ambiguous resource.

## Revocation and future approvals

When the pilot is complete, an account administrator should detach the two replacement policies and `SignInLocalDevelopmentAccess` from `te-kaupapa-dev`, deactivate/delete its access material according to the account process, and delete the IAM user only after confirming no approved Te Kaupapa task still uses it. These identity-management actions are intentionally outside these developer policies.

Separate approval is required before adding permissions for RDS/PostgreSQL, SES identity creation or modification, SES production access, Secrets Manager writes, production hosting/deployment, IAM changes, a CloudFormation service role, or any CareFlow integration.

## AWS Console attachment sequence

1. Create customer-managed policy `TeKaupapaMilestone1CloudFormation` from `infra/iam/te-kaupapa-m1-cloudformation-policy.json`.
2. Create customer-managed policy `TeKaupapaMilestone1CognitoSes` from `infra/iam/te-kaupapa-m1-cognito-ses-policy.json`.
3. Attach both new policies to `te-kaupapa-dev`; retain `SignInLocalDevelopmentAccess`.
4. Confirm all three required policies are attached and that the replacement JSON documents are accepted by the console.
5. Only then detach `TeKaupapaMilestone1StagingDeveloper`. Do not delete that old policy yet.

## Source verification

This design follows AWS’s service authorization references for [CloudFormation](https://docs.aws.amazon.com/service-authorization/latest/reference/list_awscloudformation.html), [Cognito user pools](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncognitouserpools.html), and [SES v2](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html). Recheck those references and run IAM Access Analyzer validation in the target account before attachment because service condition-key support can change.
