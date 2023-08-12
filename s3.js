import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const createS3Instance = () => {
  // AWS CONFIGURATION
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY;
  const secretAccessKey = process.env.AWS_SECRET_KEY;

  // Create a new S3 Instance
  return new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

export const uploadToS3 = async (files = []) => {
  const s3Instance = createS3Instance();
  const bucketName = process.env.AWS_BUCKET_NAME;

  // Upload each given file to the s3 Bucket
  for (let file of files) {
    // command parameters
    const params = {
      Bucket: bucketName,
      ContentType: file.mimetype,
      Key: file.originalname,
      Body: file.buffer,
    };
    // create a new command
    const command = new PutObjectCommand(params);
    // upload file to s3
    await s3Instance.send(command);
  }
};

export const removeFroms3 = async (...fileNames) => {
  const s3Instance = createS3Instance();
  const bucketName = process.env.AWS_BUCKET_NAME;

  // Delete each given filename from the s3 Bucket
  for (let filename of fileNames) {
    // command parameters
    const params = {
      Bucket: bucketName,
      Key: filename,
    };
    // create a new command
    const command = new DeleteObjectCommand(params);
    // Delete filename from s3
    await s3Instance.send(command);
  }
};
