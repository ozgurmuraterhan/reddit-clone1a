'use client';
import { useState } from 'react';
import { Form, Input, Button, Checkbox, Card, message, Divider } from 'antd';
import { UserOutlined, LockOutlined, GoogleOutlined, GithubOutlined } from '@ant-design/icons';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Layout from '../components/Layout';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
      });

      if (result.error) {
        message.error(result.error);
      } else {
        message.success('Login successful!');
        router.push('/');
      }
    } catch (error) {
      message.error('An error occurred during login.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="flex justify-center items-center min-h-[70vh]">
        <Card title="Log In" style={{ width: 400 }}>
          <Form
            name="login"
            initialValues={{ remember: true }}
            onFinish={onFinish}
            layout="vertical"
          >
            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: 'Please input your email!' },
                { type: 'email', message: 'Please enter a valid email!' },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="Email" />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              rules={[{ required: true, message: 'Please input your password!' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Password" />
            </Form.Item>

            <Form.Item>
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>Remember me</Checkbox>
              </Form.Item>

              <Link href="/forgot-password" className="float-right">
                Forgot password?
              </Link>
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Log in
              </Button>
            </Form.Item>

            <Divider plain>Or login with</Divider>

            <div className="flex justify-center space-x-4">
              <Button icon={<GoogleOutlined />} onClick={() => signIn('google')}>
                Google
              </Button>
              <Button icon={<GithubOutlined />} onClick={() => signIn('github')}>
                GitHub
              </Button>
            </div>

            <div className="mt-4 text-center">
              New to Reddit Clone? <Link href="/register">Sign up</Link>
            </div>
          </Form>
        </Card>
      </div>
    </Layout>
  );
}
