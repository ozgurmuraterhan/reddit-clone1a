'use client';
import { useState, useEffect } from 'react';
import {
  Card,
  Tabs,
  Avatar,
  Button,
  Form,
  Input,
  Space,
  Upload,
  message,
  Statistic,
  List,
  Divider,
} from 'antd';
import {
  UserOutlined,
  UploadOutlined,
  SettingOutlined,
  SaveOutlined,
  BookOutlined,
  CommentOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useSession } from 'next-auth/react';
import axios from 'axios';
import Layout from '../components/Layout';
import ProtectedRoute from '../components/ProtectedRoute';

export default function Profile() {
  const { data: session } = useSession();
  const [form] = Form.useForm();
  const [userProfile, setUserProfile] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [userComments, setUserComments] = useState([]);
  const [savedItems, setSavedItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session) {
      fetchUserData();
    }
  }, [session]);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      const userId = session.user.id;

      const userRes = await axios.get(`http://localhost:5000/api/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      setUserProfile(userRes.data.data);

      // Set form values
      form.setFieldsValue({
        username: userRes.data.data.username,
        email: userRes.data.data.email,
        bio: userRes.data.data.bio || '',
      });

      // Fetch posts
      const postsRes = await axios.get(`http://localhost:5000/api/users/${userId}/posts`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      setUserPosts(postsRes.data.data);

      // Fetch saved items
      const savedRes = await axios.get(`http://localhost:5000/api/users/${userId}/saved-posts`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      setSavedItems(savedRes.data.data);

      // Fetch comments
      const commentsRes = await axios.get(`http://localhost:5000/api/users/${userId}/comments`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      setUserComments(commentsRes.data.data);
    } catch (error) {
      console.error('Error fetching user data:', error);
      message.error('Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (values) => {
    try {
      await axios.put(`http://localhost:5000/api/users/${session.user.id}`, values, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      message.success('Profile updated successfully');
      fetchUserData();
    } catch (error) {
      console.error('Error updating profile:', error);
      message.error('Failed to update profile');
    }
  };

  return (
    <ProtectedRoute>
      <Layout>
        <Tabs defaultActiveKey="overview">
          <Tabs.TabPane tab="Overview" key="overview">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-1">
                <Card className="text-center">
                  <Avatar size={100} src={userProfile?.profilePicture} icon={<UserOutlined />} />
                  <h2 className="mt-4 text-xl font-bold">{userProfile?.username}</h2>
                  <p className="text-gray-500">{userProfile?.email}</p>

                  <Divider />

                  <div className="grid grid-cols-3 gap-2 my-4">
                    <Statistic title="Karma" value={userProfile?.totalKarma || 0} />
                    <Statistic title="Posts" value={userPosts.length} />
                    <Statistic title="Comments" value={userComments.length} />
                  </div>

                  <p className="mt-4 text-left text-gray-700">
                    {userProfile?.bio || 'No bio provided yet.'}
                  </p>

                  <Divider />

                  <div className="text-left">
                    <p>
                      <strong>Joined:</strong>{' '}
                      {userProfile?.createdAt
                        ? new Date(userProfile.createdAt).toLocaleDateString()
                        : 'Unknown'}
                    </p>
                  </div>
                </Card>
              </div>

              <div className="md:col-span-2">
                <Card title="Recent Activity">
                  <List
                    itemLayout="horizontal"
                    dataSource={[...userPosts, ...userComments]
                      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                      .slice(0, 5)}
                    renderItem={(item) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={
                            <Avatar icon={item.content ? <CommentOutlined /> : <BookOutlined />} />
                          }
                          title={
                            <a
                              href={
                                item.content ? `/post/${item.post}/comments` : `/post/${item._id}`
                              }
                            >
                              {item.title || item.content?.substring(0, 50) + '...'}
                            </a>
                          }
                          description={
                            <div>
                              <p>
                                {item.content
                                  ? 'Commented on a post'
                                  : `Posted in r/${item.subreddit?.name}`}
                              </p>
                              <p className="text-gray-400">
                                {new Date(item.createdAt).toLocaleString()}
                              </p>
                            </div>
                          }
                        />
                        <div>
                          <StarOutlined /> {item.voteScore || 0}
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
              </div>
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane tab="Profile Settings" key="settings">
            <Card title="Edit Profile">
              <Form form={form} layout="vertical" onFinish={handleUpdateProfile}>
                <Form.Item
                  name="username"
                  label="Username"
                  rules={[
                    { required: true, message: 'Please input your username!' },
                    { min: 3, message: 'Username must be at least 3 characters!' },
                  ]}
                >
                  <Input prefix={<UserOutlined />} />
                </Form.Item>

                <Form.Item
                  name="email"
                  label="Email"
                  rules={[
                    { required: true, message: 'Please input your email!' },
                    { type: 'email', message: 'Please enter a valid email!' },
                  ]}
                >
                  <Input disabled />
                </Form.Item>

                <Form.Item name="bio" label="Bio">
                  <Input.TextArea
                    rows={4}
                    maxLength={500}
                    showCount
                    placeholder="Tell us about yourself"
                  />
                </Form.Item>

                <Form.Item label="Profile Picture">
                  <Upload
                    name="avatar"
                    listType="picture-card"
                    showUploadList={false}
                    beforeUpload={() => false}
                  >
                    <div>
                      <UploadOutlined />
                      <div style={{ marginTop: 8 }}>Upload</div>
                    </div>
                  </Upload>
                </Form.Item>

                <Form.Item>
                  <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                    Save Changes
                  </Button>
                </Form.Item>
              </Form>
            </Card>
          </Tabs.TabPane>

          <Tabs.TabPane tab="Posts" key="posts">
            <Card>
              <List
                itemLayout="vertical"
                dataSource={userPosts}
                renderItem={(post) => (
                  <List.Item
                    key={post._id}
                    extra={
                      post.type === 'image' &&
                      post.mediaUrl && <img width={272} alt="post image" src={post.mediaUrl} />
                    }
                  >
                    <List.Item.Meta
                      title={<a href={`/post/${post._id}`}>{post.title}</a>}
                      description={
                        <div>
                          {' '}
                          <a href={`/r/${post.subreddit?.name}`}>r/{post.subreddit?.name}</a>
                          {' • '}
                          <span className="text-gray-400">
                            {new Date(post.createdAt).toLocaleString()}
                          </span>
                        </div>
                      }
                    />
                    <div className="mt-2">
                      {post.type === 'text' && <p>{post.content?.substring(0, 200)}...</p>}
                      {post.type === 'link' && (
                        <a href={post.url} target="_blank" rel="noopener noreferrer">
                          {post.url}
                        </a>
                      )}
                    </div>
                    <div className="mt-2">
                      <Space>
                        <Button size="small" icon={<CommentOutlined />}>
                          {post.commentCount || 0} Comments
                        </Button>
                        <span>
                          <StarOutlined /> {post.voteScore || 0} points
                        </span>
                      </Space>
                    </div>
                  </List.Item>
                )}
                pagination={{
                  pageSize: 5,
                }}
              />
            </Card>
          </Tabs.TabPane>

          <Tabs.TabPane tab="Comments" key="comments">
            <Card>
              <List
                itemLayout="vertical"
                dataSource={userComments}
                renderItem={(comment) => (
                  <List.Item key={comment._id}>
                    <List.Item.Meta
                      title={
                        <a href={`/post/${comment.post}/comments/${comment._id}`}>
                          Comment on: {comment.postTitle || 'Post'}
                        </a>
                      }
                      description={
                        <div>
                          <span className="text-gray-400">
                            {new Date(comment.createdAt).toLocaleString()}
                          </span>
                        </div>
                      }
                    />
                    <div className="mt-2">
                      <p>{comment.content}</p>
                    </div>
                    <div className="mt-2">
                      <Space>
                        <span>
                          <StarOutlined /> {comment.voteScore || 0} points
                        </span>
                      </Space>
                    </div>
                  </List.Item>
                )}
                pagination={{
                  pageSize: 5,
                }}
              />
            </Card>
          </Tabs.TabPane>

          <Tabs.TabPane tab="Saved" key="saved">
            <Card>
              <List
                itemLayout="vertical"
                dataSource={savedItems}
                renderItem={(item) => (
                  <List.Item
                    key={item._id}
                    extra={
                      item.type === 'image' &&
                      item.mediaUrl && <img width={272} alt="post image" src={item.mediaUrl} />
                    }
                  >
                    <List.Item.Meta
                      title={<a href={`/post/${item._id}`}>{item.title}</a>}
                      description={
                        <div>
                          <a href={`/r/${item.subreddit?.name}`}>r/{item.subreddit?.name}</a>
                          {' • '}
                          <a href={`/user/${item.author?.username}`}>u/{item.author?.username}</a>
                          {' • '}
                          <span className="text-gray-400">
                            {new Date(item.createdAt).toLocaleString()}
                          </span>
                        </div>
                      }
                    />
                    <div className="mt-2">
                      {item.type === 'text' && <p>{item.content?.substring(0, 200)}...</p>}
                      {item.type === 'link' && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          {item.url}
                        </a>
                      )}
                    </div>
                    <div className="mt-2">
                      <Space>
                        <Button size="small" icon={<CommentOutlined />}>
                          {item.commentCount || 0} Comments
                        </Button>
                        <span>
                          <StarOutlined /> {item.voteScore || 0} points
                        </span>
                      </Space>
                    </div>
                  </List.Item>
                )}
                pagination={{
                  pageSize: 5,
                }}
              />
            </Card>
          </Tabs.TabPane>
        </Tabs>
      </Layout>
    </ProtectedRoute>
  );
}
