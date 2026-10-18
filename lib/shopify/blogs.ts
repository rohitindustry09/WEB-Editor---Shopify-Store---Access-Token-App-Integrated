import { shopifyGraphQL } from "./client";

export interface Article {
  id: string;
  title: string;
  publishedAt: string | null;
  author: { name: string } | null;
}

export interface BlogSummary {
  id: string;
  title: string;
  handle: string;
  articles: { nodes: Article[] };
}

const BLOGS_QUERY = `
  query Blogs($first: Int!) {
    blogs(first: $first) {
      nodes {
        id
        title
        handle
        articles(first: 10, sortKey: PUBLISHED_AT, reverse: true) {
          nodes {
            id
            title
            publishedAt
            author: authorV2 { name }
          }
        }
      }
    }
  }
`;

export async function getBlogs(): Promise<BlogSummary[]> {
  const data = await shopifyGraphQL<{ blogs: { nodes: BlogSummary[] } }>(BLOGS_QUERY, { first: 20 });
  return data.blogs.nodes;
}
