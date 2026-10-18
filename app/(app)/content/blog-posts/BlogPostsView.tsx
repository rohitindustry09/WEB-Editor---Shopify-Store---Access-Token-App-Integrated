"use client";

import { Page, Layout, Card, IndexTable, Text, Box, BlockStack } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import type { BlogSummary } from "@/lib/shopify/blogs";

export function BlogPostsView({ blogs, error }: { blogs: BlogSummary[]; error: string | null }) {
  const totalArticles = blogs.reduce((sum, b) => sum + b.articles.nodes.length, 0);

  return (
    <Page fullWidth title="Blog posts" backAction={{ content: "Content", url: "/content" }}>
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        <Layout.Section>
          {!error && totalArticles === 0 ? (
            <ResourceEmptyState heading="No blog posts yet">
              <p>Articles across your store&apos;s blogs will show up here.</p>
            </ResourceEmptyState>
          ) : (
            <BlockStack gap="400">
              {blogs.map((blog) => (
                <Card key={blog.id} padding="0">
                  <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                    <Text as="h2" variant="headingSm">{blog.title}</Text>
                  </Box>
                  {blog.articles.nodes.length === 0 ? (
                    <Box padding="400">
                      <Text as="p" tone="subdued">No posts in this blog yet.</Text>
                    </Box>
                  ) : (
                    <IndexTable
                      resourceName={{ singular: "post", plural: "posts" }}
                      itemCount={blog.articles.nodes.length}
                      selectable={false}
                      headings={[{ title: "Title" }, { title: "Author" }, { title: "Published" }]}
                    >
                      {blog.articles.nodes.map((a, index) => (
                        <IndexTable.Row id={a.id} key={a.id} position={index}>
                          <IndexTable.Cell><Text as="span" fontWeight="semibold">{a.title}</Text></IndexTable.Cell>
                          <IndexTable.Cell>{a.author?.name ?? "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "Draft"}</IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  )}
                </Card>
              ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
