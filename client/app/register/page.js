'use client';
import { useState } from 'react';
import { Form, Input, Button, Card, message, Divider } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  GoogleOutlined,
  GithubOutlined,
} from '@ant-design/icons';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import Layout from '../components/Layout';

export default function Register() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      // Register the user
      await axios.post(
        'http://localhost:5000/api/auth/register',
        {
          username: values.username,
          email: values.email,
          password: values.password,
        },
        {
          withCredentials: true, // This is important for cookies/sessions
        },
      );

      message.success('Registration successful! Please log in.');

      // Automatically sign in after registration
      const result = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
      });

      if (!result.error) {
        router.push('/');
      } else {
        router.push('/login');
      }
    } catch (error) {
      if (error.response && error.response.data) {
        message.error(error.response.data.error || 'Registration failed');
      } else {
        message.error('An error occurred during registration.');
      }
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="flex justify-center items-center min-h-[70vh]">
        <Card title="Create Your Account" style={{ width: 400 }}>
          <Form
            name="register"
            initialValues={{ remember: true }}
            onFinish={onFinish}
            layout="vertical"
          >
            <Form.Item
              name="username"
              label="Username"
              rules={[
                { required: true, message: 'Please input your username!' },
                { min: 3, message: 'Username must be at least 3 characters!' },
                { max: 20, message: 'Username cannot exceed 20 characters!' },
                {
                  pattern: /^[a-zA-Z0-9_-]+$/,
                  message: 'Username can only contain letters, numbers, underscores and hyphens!',
                },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="Username" />
            </Form.Item>

            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: 'Please input your email!' },
                { type: 'email', message: 'Please enter a valid email!' },
              ]}
            >
              <Input prefix={<MailOutlined />} placeholder="Email" />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: 'Please input your password!' },
                { min: 6, message: 'Password must be at least 6 characters!' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Password" />
            </Form.Item>

            <Form.Item
              name="confirm"
              label="Confirm Password"
              dependencies={['password']}
              hasFeedback
              rules={[
                { required: true, message: 'Please confirm your password!' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('The two passwords do not match!'));
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Confirm Password" />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Register
              </Button>
            </Form.Item>

            <Divider plain>Or sign up with</Divider>

            <div className="flex justify-center space-x-4">
              <Button icon={<GoogleOutlined />} onClick={() => signIn('google')}>
                Google
              </Button>
              <Button icon={<GithubOutlined />} onClick={() => signIn('github')}>
                GitHub
              </Button>
            </div>

            <div className="mt-4 text-center">
              Already have an account? <Link href="/login">Log in</Link>
            </div>
          </Form>
        </Card>
      </div>
    </Layout>
  );
}
