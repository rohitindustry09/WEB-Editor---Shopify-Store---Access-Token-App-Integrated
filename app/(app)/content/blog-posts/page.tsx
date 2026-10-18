import { BlogPostsView } from "./BlogPostsView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getBlogs, type BlogSummary } from "@/lib/shopify/blogs";

export default async function BlogPostsPage() {
  let blogs: BlogSummary[] = [];
  let error: string | null = null;

  try {
    blogs = await getBlogs();
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading blog posts.";
  }

  return <BlogPostsView blogs={blogs} error={error} />;
}
