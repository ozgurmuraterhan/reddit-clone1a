'use client';
import { useState, useEffect } from 'react';
import { Card, List, Space, Tag, Button, Spin, Empty } from 'antd';
import { UpOutlined, DownOutlined, MessageOutlined, StarOutlined } from '@ant-design/icons';
import { useSession } from 'next-auth/react';
import Layout from './components/Layout';
import axios from 'axios';

export default function Home() {
  const { data: session } = useSession();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const res = await axios.get('http://localhost:5000/api/posts');
        setPosts(res.data.data);
      } catch (error) {
        console.error('Error fetching posts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPosts();
  }, []);

  const handleVote = async (id, value) => {
    if (!session) {
      // Redirect to login
      return;
    }

    try {
      const res = await axios.post(
        `http://localhost:5000/api/posts/${id}/vote`,
        {
          value,
        },
        {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        },
      );

      // Update posts with new vote count
      setPosts(posts.map((post) => (post._id === id ? { ...post, ...res.data.data } : post)));
    } catch (error) {
      console.error('Error voting:', error);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <Spin size="large" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {posts.length === 0 ? (
        <Empty description="No posts found" />
      ) : (
        <List
          itemLayout="vertical"
          size="large"
          pagination={{
            pageSize: 10,
          }}
          dataSource={posts}
          renderItem={(post) => (
            <List.Item
              key={post._id}
              actions={[
                <Space key="votes">
                  <Button
                    icon={<UpOutlined />}
                    type={post.userVote === 1 ? 'primary' : 'default'}
                    shape="circle"
                    onClick={() => handleVote(post._id, post.userVote === 1 ? 0 : 1)}
                  />
                  <span>{post.voteScore || 0}</span>
                  <Button
                    icon={<DownOutlined />}
                    type={post.userVote === -1 ? 'primary' : 'default'}
                    shape="circle"
                    onClick={() => handleVote(post._id, post.userVote === -1 ? 0 : -1)}
                  />
                </Space>,
                <Space key="comments">
                  <MessageOutlined />
                  {post.commentCount || 0} comments
                </Space>,
              ]}
              extra={
                post.type === 'image' &&
                post.mediaUrl && <img width={272} alt="post image" src={post.mediaUrl} />
              }
            >
              <List.Item.Meta
                title={<a href={`/post/${post._id}`}>{post.title}</a>}
                description={
                  <div>
                    <a href={`/r/${post.subreddit?.name}`}>r/{post.subreddit?.name}</a>
                    {' • '}
                    <a href={`/user/${post.author?.username}`}>u/{post.author?.username}</a>
                    {post.flair && (
                      <Tag
                        color={post.flair.backgroundColor}
                        style={{ color: post.flair.textColor }}
                      >
                        {post.flair.text}
                      </Tag>
                    )}
                  </div>
                }
              />
              {post.type === 'text' && post.content && (
                <div className="mt-2">
                  {post.content.slice(0, 300)}
                  {post.content.length > 300 ? '...' : ''}
                </div>
              )}
            </List.Item>
          )}
        />
      )}
    </Layout>
  );
}
