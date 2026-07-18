import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import {
  SignedUploadResult,
  StoragePort,
} from '../ports/storage.port';

@Injectable()
export class CloudinaryAdapter implements StoragePort {
  private readonly folderRoot: string;

  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
    this.folderRoot = this.config.get<string>(
      'CLOUDINARY_FOLDER',
      'tempat-kost',
    );
  }

  async createSignedUpload(input: {
    workspaceId: string;
    folder: string;
    publicId?: string;
  }): Promise<SignedUploadResult> {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `${this.folderRoot}/${input.workspaceId}/${input.folder}`;
    const params: Record<string, string | number> = {
      timestamp,
      folder,
    };
    if (input.publicId) {
      params.public_id = input.publicId;
    }
    const signature = cloudinary.utils.api_sign_request(
      params,
      this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
    );
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME')}/auto/upload`,
      publicId: input.publicId ?? '',
      folder,
      timestamp,
      signature,
      apiKey: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      cloudName: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
    };
  }

  getPrivateDeliveryUrl(publicId: string, expiresInSeconds = 300): string {
    return cloudinary.url(publicId, {
      type: 'authenticated',
      sign_url: true,
      secure: true,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    });
  }
}
