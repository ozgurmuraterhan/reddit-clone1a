'use client';
import { useState, useEffect } from 'react';
import {
  Layout as AntLayout,
  Menu,
  Button,
  Drawer,
  Avatar,
  Input,
  Badge,
  Dropdown,
  Spin,
  theme,
} from 'antd';
import {
  MenuOutlined,
  HomeOutlined,
  CompassOutlined,
  BellOutlined,
  UserOutlined,
  SearchOutlined,
  SettingOutlined,
  LogoutOutlined,
  PlusOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';

const { Header, Content, Sider } = AntLayout;

export default function Layout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { token } = theme.useToken();

  const [collapsed, setCollapsed] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [subreddits, setSubreddits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const handleResize = () => {
      setMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setMobileDrawerOpen(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    if (session) {
      fetchSubreddits();
      fetchNotifications();
    } else {
      setLoading(false);
    }

    return () => window.removeEventListener('resize', handleResize);
  }, [session]);

  const fetchSubreddits = async () => {
    try {
      setLoading(true);
      const res = await axios.get('http://localhost:5000/api/subreddits/subscribed', {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
        },
      });
      setSubreddits(res.data.data);
    } catch (error) {
      console.error('Error fetching subreddits:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/notifications', {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
        },
      });
      setNotifications(res.data.data);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const handleSearch = (value) => {
    if (value) {
      router.push(`/search?q=${encodeURIComponent(value)}`);
    }
  };

  const userMenu = (
    <Menu>
      <Menu.Item key="profile" icon={<UserOutlined />} onClick={() => router.push('/profile')}>
        Profile
      </Menu.Item>
      {session?.user.isAdmin && (
        <Menu.Item key="admin" icon={<DashboardOutlined />} onClick={() => router.push('/admin')}>
          Admin Dashboard
        </Menu.Item>
      )}
      <Menu.Item key="settings" icon={<SettingOutlined />} onClick={() => router.push('/settings')}>
        Settings
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item
        key="logout"
        icon={<LogoutOutlined />}
        onClick={() => signOut({ callbackUrl: '/' })}
      >
        Logout
      </Menu.Item>
    </Menu>
  );

  const notificationMenu = (
    <Menu>
      <Menu.Item key="notifications-title" disabled>
        <span className="font-bold">Notifications</span>
      </Menu.Item>
      <Menu.Divider />
      {notifications.length > 0 ? (
        notifications.slice(0, 5).map((notification) => (
          <Menu.Item key={notification._id} onClick={() => router.push(notification.link || '/')}>
            <div>
              <div className="font-semibold">{notification.title}</div>
              <div className="text-sm text-gray-500">{notification.content}</div>
              <div className="text-xs text-gray-400">
                {new Date(notification.createdAt).toLocaleString()}
              </div>
            </div>
          </Menu.Item>
        ))
      ) : (
        <Menu.Item key="no-notifications" disabled>
          No notifications
        </Menu.Item>
      )}
      <Menu.Divider />
      <Menu.Item key="all-notifications" onClick={() => router.push('/notifications')}>
        View all notifications
      </Menu.Item>
    </Menu>
  );

  const renderSider = () => (
    <Sider
      width={200}
      collapsible
      collapsed={collapsed}
      onCollapse={setCollapsed}
      style={{
        overflow: 'auto',
        height: '100vh',
        position: 'fixed',
        left: 0,
        top: 64,
        bottom: 0,
        display: mobile ? 'none' : 'block',
      }}
    >
      <Menu
        mode="inline"
        selectedKeys={[pathname]}
        style={{ height: '100%' }}
        items={[
          {
            key: '/',
            icon: <HomeOutlined />,
            label: <Link href="/">Home</Link>,
          },
          {
            key: '/explore',
            icon: <CompassOutlined />,
            label: <Link href="/explore">Explore</Link>,
          },
          {
            key: 'subreddits',
            icon: <CompassOutlined />,
            label: 'My Subreddits',
            children: loading
              ? [{ key: 'loading', label: <Spin size="small" /> }]
              : subreddits.map((subreddit) => ({
                  key: `/r/${subreddit.name}`,
                  label: <Link href={`/r/${subreddit.name}`}>r/{subreddit.name}</Link>,
                })),
          },
        ]}
      />
    </Sider>
  );

  const mobileDrawer = (
    <Drawer
      title="Menu"
      placement="left"
      open={mobileDrawerOpen}
      onClose={() => setMobileDrawerOpen(false)}
      style={{ zIndex: 999 }}
    >
      <Menu
        mode="inline"
        selectedKeys={[pathname]}
        onClick={() => setMobileDrawerOpen(false)}
        items={[
          {
            key: '/',
            icon: <HomeOutlined />,
            label: <Link href="/">Home</Link>,
          },
          {
            key: '/explore',
            icon: <CompassOutlined />,
            label: <Link href="/explore">Explore</Link>,
          },
          {
            key: 'subreddits-header',
            label: 'My Subreddits',
            type: 'group',
          },
          ...subreddits.map((subreddit) => ({
            key: `/r/${subreddit.name}`,
            label: <Link href={`/r/${subreddit.name}`}>r/{subreddit.name}</Link>,
          })),
        ]}
      />
    </Drawer>
  );

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          position: 'fixed',
          zIndex: 1,
          width: '100%',
          padding: '0 16px',
          backgroundColor: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {mobile && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileDrawerOpen(true)}
              style={{ marginRight: 16 }}
            />
          )}

          <Link href="/" style={{ display: 'flex', alignItems: 'center' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: token.colorPrimary,
              }}
            >
              RedditClone
            </h1>
          </Link>
        </div>

        <div style={{ flex: 1, maxWidth: 600, margin: '0 16px' }}>
          <Input.Search placeholder="Search" onSearch={handleSearch} style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          {status === 'authenticated' ? (
            <>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => router.push('/submit')}
                style={{ marginRight: 8 }}
              >
                {!mobile && 'Create Post'}
              </Button>

              <Dropdown overlay={notificationMenu} trigger={['click']}>
                <Badge
                  count={notifications.filter((n) => !n.isRead).length}
                  style={{ marginRight: 16 }}
                >
                  <Button type="text" icon={<BellOutlined />} />
                </Badge>
              </Dropdown>

              <Dropdown overlay={userMenu} trigger={['click']}>
                <Button type="text">
                  <Avatar
                    size="small"
                    src={session.user.image}
                    icon={!session.user.image && <UserOutlined />}
                    style={{ marginRight: 8 }}
                  />
                  {!mobile && session.user.name}
                </Button>
              </Dropdown>
            </>
          ) : (
            <>
              <Button type="link" onClick={() => router.push('/login')}>
                Login
              </Button>
              <Button type="primary" onClick={() => router.push('/register')}>
                Register
              </Button>
            </>
          )}{' '}
        </div>
      </Header>

      {renderSider()}
      {mobileDrawer}

      <AntLayout style={{ marginLeft: mobile ? 0 : collapsed ? 80 : 200 }}>
        <Content
          style={{
            margin: '80px 16px 0',
            overflow: 'initial',
          }}
        >
          <div
            style={{
              padding: 24,
              minHeight: 360,
              background: token.colorBgContainer,
              borderRadius: token.borderRadius,
            }}
          >
            {children}
          </div>
        </Content>
        <AntLayout.Footer style={{ textAlign: 'center' }}>
          Reddit Clone ©{new Date().getFullYear()} Created with Next.js and Ant Design
        </AntLayout.Footer>
      </AntLayout>
    </AntLayout>
  );
}
