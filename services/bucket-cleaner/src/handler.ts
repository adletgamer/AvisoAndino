import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
  type ObjectIdentifier,
} from '@aws-sdk/client-s3';

interface CloudFormationEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: { BucketName: string };
}

const s3 = new S3Client({});

export async function handler(event: CloudFormationEvent): Promise<void> {
  const physicalResourceId = event.PhysicalResourceId ?? `empty-${event.ResourceProperties.BucketName}`;
  try {
    if (event.RequestType === 'Delete') {
      await emptyBucket(event.ResourceProperties.BucketName);
    }
    await respond(event, 'SUCCESS', physicalResourceId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Error desconocido';
    await respond(event, 'FAILED', physicalResourceId, reason);
  }
}

async function emptyBucket(bucket: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    const objects: ObjectIdentifier[] = (page.Contents ?? [])
      .flatMap(({ Key }) => Key ? [{ Key }] : []);
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects, Quiet: true },
      }));
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
}

async function respond(
  event: CloudFormationEvent,
  status: 'SUCCESS' | 'FAILED',
  physicalResourceId: string,
  reason?: string,
): Promise<void> {
  const body = JSON.stringify({
    Status: status,
    Reason: reason ?? `See CloudWatch logs for request ${event.RequestId}`,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: {},
  });
  const response = await fetch(event.ResponseURL, {
    method: 'PUT',
    headers: { 'content-length': String(Buffer.byteLength(body)) },
    body,
  });
  if (!response.ok) {
    throw new Error(`CloudFormation response failed with HTTP ${response.status}`);
  }
}
