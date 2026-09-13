import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as budgets from "aws-cdk-lib/aws-budgets";
import { Construct } from "constructs";

export interface CertFlagStackProps extends cdk.StackProps {
  billingAlertEmail: string;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export class CertFlagStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CertFlagStackProps) {
    super(scope, id, props);

    // --- S3: private bucket for ephemeral uploads/results ---
    const assetsBucket = new s3.Bucket(this, "AssetsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          // S3 lifecycle expiration is day-granular; 1 day is the practical minimum for
          // automatic cleanup. Objects are also keyed by random UUID job IDs and the
          // presigned URLs that grant access to them expire in minutes, so same-day
          // deletion is a reasonable ceiling for this public, unauthenticated tool.
          expiration: Duration.days(1),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      cors: [
        {
          // Wildcard origin is safe here: actual authorization comes from the presigned
          // URL signature and policy conditions (content-type/length), not from CORS -
          // CORS only governs whether browser JS can read the response.
          allowedOrigins: ["*"],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
        },
      ],
    });

    // --- S3: private bucket for the static frontend, served only via CloudFront ---
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // --- Lambda: presign (zip, no native deps) ---
    const presignFn = new NodejsFunction(this, "PresignFn", {
      entry: path.join(__dirname, "../../lambda/presign/src/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(3),
      environment: {
        ASSETS_BUCKET: assetsBucket.bucketName,
        MAX_UPLOAD_BYTES: String(MAX_UPLOAD_BYTES),
      },
    });
    assetsBucket.grantPut(presignFn, "uploads/*");

    // --- Lambda: process (container image, bundles poppler-utils via Dockerfile) ---
    const processFn = new lambda.DockerImageFunction(this, "ProcessFn", {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, "../../lambda/process")),
      memorySize: 2048,
      timeout: Duration.seconds(30),
      // No reservedConcurrentExecutions: Lambda requires at least 10 unreserved executions
      // left account-wide, which this account's default concurrency limit doesn't leave room
      // for alongside a reservation. Abuse protection instead comes from the WAF rate rule and
      // the API Gateway stage throttle below. Revisit if the account limit is raised.
      environment: {
        ASSETS_BUCKET: assetsBucket.bucketName,
        MAX_UPLOAD_BYTES: String(MAX_UPLOAD_BYTES),
      },
    });
    assetsBucket.grantRead(processFn, "uploads/*");
    assetsBucket.grantReadWrite(processFn, "results/*");

    // --- API Gateway HTTP API ---
    const httpApi = new apigwv2.HttpApi(this, "Api", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.POST],
        allowHeaders: ["content-type"],
      },
    });

    // Routes are prefixed with /api because CloudFront forwards the full request path
    // (including /api) to this origin for the "/api/*" behavior below - it doesn't strip it.
    httpApi.addRoutes({
      path: "/api/presign",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration("PresignIntegration", presignFn),
    });
    httpApi.addRoutes({
      path: "/api/process",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration("ProcessIntegration", processFn),
    });

    // Second layer of throttling under the WAF rate rule below.
    const cfnStage = httpApi.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    cfnStage.defaultRouteSettings = { throttlingRateLimit: 5, throttlingBurstLimit: 10 };

    // --- CloudFront: static site + /api/* proxy to the HTTP API, single origin for CORS-free frontend calls ---
    const apiDomain = `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`;

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.HttpOrigin(apiDomain),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // ALL_VIEWER forwards the original Host header (the CloudFront domain), which
          // API Gateway's execute-api endpoint rejects with 403 Forbidden since it doesn't
          // match its own domain. This variant forwards everything else but lets CloudFront
          // set Host to the origin's own domain.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: "index.html",
    });

    // --- WAF: rate-based abuse guard on the CloudFront distribution (must be us-east-1) ---
    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "CertFlagWebAcl",
      },
      rules: [
        {
          name: "RateLimit",
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 300,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "CertFlagRateLimit",
          },
        },
      ],
    });

    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride("DistributionConfig.WebACLId", webAcl.attrArn);

    // --- Deploy the static frontend ---
    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../../frontend"))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // --- Billing alarm ---
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 10, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "EMAIL", address: props.billingAlertEmail }],
        },
      ],
    });

    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
