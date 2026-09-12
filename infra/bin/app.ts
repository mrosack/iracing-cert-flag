#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CertFlagStack } from "../lib/cert-flag-stack";

const app = new cdk.App();

// Deployed in us-east-1 deliberately: a CloudFront WAF WebACL must live in us-east-1
// regardless of where the rest of the stack runs, so keeping everything here avoids
// a second cross-region stack for the MVP.
new CertFlagStack(app, "CertFlagStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  billingAlertEmail: process.env.BILLING_ALERT_EMAIL ?? "mrosack@gmail.com",
});
