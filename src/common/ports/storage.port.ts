export const STORAGE_PORT = Symbol('STORAGE_PORT');

export interface SignedUploadResult {
  uploadUrl: string;
  publicId: string;
  folder: string;
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
}

export interface StoragePort {
  createSignedUpload(input: {
    workspaceId: string;
    folder: string;
    publicId?: string;
  }): Promise<SignedUploadResult>;

  getPrivateDeliveryUrl(publicId: string, expiresInSeconds?: number): string;
}
