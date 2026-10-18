import "server-only";
import { shopifyGraphQL } from "./client";
import type { UserError } from "./types";

export interface StoreFile {
  id: string;
  alt: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
}

const FILES_QUERY = `
  query StoreFiles($first: Int!, $query: String) {
    files(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        alt
        ... on MediaImage {
          image { url width height }
        }
      }
    }
  }
`;

interface FileNode {
  id: string;
  alt: string | null;
  image: { url: string; width: number; height: number } | null;
}

export async function getStoreFiles(search?: string): Promise<StoreFile[]> {
  const query = ["media_type:IMAGE", search ? `filename:*${search}*` : ""].filter(Boolean).join(" ");
  const data = await shopifyGraphQL<{ files: { nodes: FileNode[] } }>(FILES_QUERY, {
    first: 60,
    query,
  });
  return data.files.nodes.map((f) => ({
    id: f.id,
    alt: f.alt,
    url: f.image?.url ?? null,
    width: f.image?.width ?? null,
    height: f.image?.height ?? null,
  }));
}

const STAGED_UPLOADS_MUTATION = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

export interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

export async function createStagedUpload(
  filename: string,
  mimeType: string,
  fileSize: number,
): Promise<{ target: StagedTarget | null; userErrors: UserError[] }> {
  const data = await shopifyGraphQL<{
    stagedUploadsCreate: { stagedTargets: StagedTarget[]; userErrors: UserError[] };
  }>(STAGED_UPLOADS_MUTATION, {
    input: [
      {
        filename,
        mimeType,
        fileSize: String(fileSize),
        resource: "IMAGE",
        httpMethod: "POST",
      },
    ],
  });
  return {
    target: data.stagedUploadsCreate.stagedTargets[0] ?? null,
    userErrors: data.stagedUploadsCreate.userErrors,
  };
}

const FILE_CREATE_MUTATION = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        alt
        fileStatus
        ... on MediaImage {
          image { url width height }
        }
      }
      userErrors { field message }
    }
  }
`;

export interface CreatedFile {
  id: string;
  alt: string | null;
  url: string | null;
  status: string;
}

export async function createFileFromStagedUpload(
  resourceUrl: string,
  alt: string,
): Promise<{ file: CreatedFile | null; userErrors: UserError[] }> {
  const data = await shopifyGraphQL<{
    fileCreate: {
      files: { id: string; alt: string | null; fileStatus: string; image: { url: string } | null }[];
      userErrors: UserError[];
    };
  }>(FILE_CREATE_MUTATION, {
    files: [{ alt, contentType: "IMAGE", originalSource: resourceUrl }],
  });
  const file = data.fileCreate.files[0];
  return {
    file: file
      ? { id: file.id, alt: file.alt, url: file.image?.url ?? null, status: file.fileStatus }
      : null,
    userErrors: data.fileCreate.userErrors,
  };
}
