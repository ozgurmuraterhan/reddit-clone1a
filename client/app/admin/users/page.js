'use client';
import { useState, useEffect } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  message,
  Spin,
  Space,
  Tabs,
  Card,
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  LockOutlined,
  UnlockOutlined,
  UserAddOutlined,
  SearchOutlined,
  ExportOutlined,
  UserOutlined,
  MailOutlined,
} from '@ant-design/icons';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import Layout from '../../components/Layout';

export default function UserManagement() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [isRoleModalVisible, setIsRoleModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [form] = Form.useForm();
  const [roleForm] = Form.useForm();
  const [filters, setFilters] = useState({
    username: '',
    email: '',
    status: '',
    role: '',
  });
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  // Check if user is admin
  useEffect(() => {
    if (status === 'authenticated') {
      if (!session.user.isAdmin) {
        message.error('You do not have permission to access this page');
        router.push('/');
      } else {
        fetchUsers();
        fetchRoles();
      }
    } else if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, session, router]);

  const fetchUsers = async (page = 1, pageSize = 10) => {
    try {
      setLoading(true);
      const params = {
        page,
        limit: pageSize,
        ...filters,
      };

      const res = await axios.get('http://localhost:5000/api/admin/users', {
        params,
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
        },
      });

      setUsers(res.data.data);
      setPagination({
        ...pagination,
        current: page,
        pageSize,
        total: res.data.pagination.totalDocs,
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      message.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/admin/roles', {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
        },
      });
      setRoles(res.data.data);
    } catch (error) {
      console.error('Error fetching roles:', error);
    }
  };

  const handleTableChange = (pagination) => {
    fetchUsers(pagination.current, pagination.pageSize);
  };

  const handleSearch = () => {
    fetchUsers(1, pagination.pageSize);
  };

  const handleCreateUser = () => {
    form.resetFields();
    setSelectedUser(null);
    setIsModalVisible(true);
  };

  const handleEditUser = (user) => {
    setSelectedUser(user);
    form.setFieldsValue({
      username: user.username,
      email: user.email,
      status: user.accountStatus,
    });
    setIsModalVisible(true);
  };

  const handleDeleteUser = (user) => {
    setSelectedUser(user);
    setIsDeleteModalVisible(true);
  };

  const handleAssignRole = (user) => {
    setSelectedUser(user);
    roleForm.resetFields();
    setIsRoleModalVisible(true);
  };

  const handleSuspendUser = async (user) => {
    try {
      await axios.put(
        `http://localhost:5000/api/admin/users/${user._id}/status`,
        {
          status: user.accountStatus === 'suspended' ? 'active' : 'suspended',
        },
        {
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
        },
      );

      message.success(
        `User ${user.accountStatus === 'suspended' ? 'unsuspended' : 'suspended'} successfully`,
      );
      fetchUsers(pagination.current, pagination.pageSize);
    } catch (error) {
      console.error('Error updating user status:', error);
      message.error('Failed to update user status');
    }
  };

  const confirmDelete = async () => {
    try {
      await axios.delete(`http://localhost:5000/api/admin/users/${selectedUser._id}`, {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
        },
      });

      message.success('User deleted successfully');
      fetchUsers(pagination.current, pagination.pageSize);
      setIsDeleteModalVisible(false);
    } catch (error) {
      console.error('Error deleting user:', error);
      message.error('Failed to delete user');
    }
  };

  const handleSubmitUser = async (values) => {
    try {
      if (selectedUser) {
        // Update existing user
        await axios.put(`http://localhost:5000/api/admin/users/${selectedUser._id}`, values, {
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
        });

        message.success('User updated successfully');
      } else {
        // Create new user
        await axios.post('http://localhost:5000/api/admin/users', values, {
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
        });

        message.success('User created successfully');
      }

      setIsModalVisible(false);
      fetchUsers(pagination.current, pagination.pageSize);
    } catch (error) {
      console.error('Error saving user:', error);
      message.error('Failed to save user');
    }
  };

  const handleRoleSubmit = async (values) => {
    try {
      await axios.post(
        'http://localhost:5000/api/admin/role-assignments',
        {
          userId: selectedUser._id,
          roleId: values.roleId,
          entityType: values.entityType,
          entityId: values.entityId,
        },
        {
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
        },
      );

      message.success('Role assigned successfully');
      setIsRoleModalVisible(false);
      fetchUsers(pagination.current, pagination.pageSize);
    } catch (error) {
      console.error('Error assigning role:', error);
      message.error('Failed to assign role');
    }
  };

  const columns = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (text, record) => (
        <a onClick={() => router.push(`/admin/users/${record._id}`)}>{text}</a>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: 'Status',
      dataIndex: 'accountStatus',
      key: 'accountStatus',
      render: (status) => {
        let color = 'green';
        if (status === 'pending_verification') color = 'orange';
        if (status === 'suspended') color = 'red';
        if (status === 'deleted') color = 'gray';

        return <Tag color={color}>{status}</Tag>;
      },
    },
    {
      title: 'Karma',
      dataIndex: 'totalKarma',
      key: 'totalKarma',
      render: (_, record) => {
        const totalKarma =
          record.karma?.post +
            record.karma?.comment +
            record.karma?.awardee +
            record.karma?.awarder || 0;

        return totalKarma;
      },
    },
    {
      title: 'Auth Provider',
      dataIndex: 'authProvider',
      key: 'authProvider',
      render: (provider) => <Tag>{provider || 'local'}</Tag>,
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      // ... (devam)
      render: (date) => new Date(date).toLocaleString(),
    },
    {
      title: 'Last Active',
      dataIndex: 'lastActive',
      key: 'lastActive',
      render: (date) => (date ? new Date(date).toLocaleString() : 'Never'),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => handleEditUser(record)} type="text" />
          <Button
            icon={record.accountStatus === 'suspended' ? <UnlockOutlined /> : <LockOutlined />}
            onClick={() => handleSuspendUser(record)}
            type="text"
            danger={record.accountStatus !== 'suspended'}
          />
          <Button
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteUser(record)}
            type="text"
            danger
          />
          <Button onClick={() => handleAssignRole(record)} type="primary" size="small">
            Assign Role
          </Button>
        </Space>
      ),
    },
  ];

  if (loading && users.length === 0) {
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
      <div className="pb-4 mb-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold">User Management</h1>
        <p className="text-gray-500">Manage user accounts and permissions</p>
      </div>

      <Card className="mb-4">
        <Form layout="inline" onFinish={handleSearch}>
          <Form.Item name="username">
            <Input
              placeholder="Username"
              prefix={<UserOutlined />}
              value={filters.username}
              onChange={(e) => setFilters({ ...filters, username: e.target.value })}
            />
          </Form.Item>
          <Form.Item name="email">
            <Input
              placeholder="Email"
              prefix={<MailOutlined />}
              value={filters.email}
              onChange={(e) => setFilters({ ...filters, email: e.target.value })}
            />
          </Form.Item>
          <Form.Item name="status">
            <Select
              placeholder="Status"
              style={{ width: 120 }}
              value={filters.status}
              onChange={(value) => setFilters({ ...filters, status: value })}
              allowClear
            >
              <Select.Option value="active">Active</Select.Option>
              <Select.Option value="pending_verification">Pending</Select.Option>
              <Select.Option value="suspended">Suspended</Select.Option>
              <Select.Option value="deleted">Deleted</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
              Search
            </Button>
          </Form.Item>
          <Form.Item>
            <Button icon={<ExportOutlined />}>Export</Button>
          </Form.Item>
        </Form>
      </Card>

      <div className="mb-4">
        <Button type="primary" icon={<UserAddOutlined />} onClick={handleCreateUser}>
          Create New User
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={users}
        rowKey="_id"
        pagination={pagination}
        onChange={handleTableChange}
        loading={loading}
      />

      {/* User Create/Edit Modal */}
      <Modal
        title={selectedUser ? 'Edit User' : 'Create New User'}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmitUser}>
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: 'Please input the username!' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Please input the email!' },
              { type: 'email', message: 'Please enter a valid email!' },
            ]}
          >
            <Input />
          </Form.Item>

          {!selectedUser && (
            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: 'Please input the password!' },
                { min: 6, message: 'Password must be at least 6 characters!' },
              ]}
            >
              <Input.Password />
            </Form.Item>
          )}

          <Form.Item
            name="status"
            label="Account Status"
            rules={[{ required: true, message: 'Please select account status!' }]}
          >
            <Select>
              <Select.Option value="active">Active</Select.Option>
              <Select.Option value="pending_verification">Pending Verification</Select.Option>
              <Select.Option value="suspended">Suspended</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item className="mb-0 text-right">
            <Button onClick={() => setIsModalVisible(false)} style={{ marginRight: 8 }}>
              Cancel
            </Button>
            <Button type="primary" htmlType="submit">
              Save
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        title="Delete User"
        open={isDeleteModalVisible}
        onOk={confirmDelete}
        onCancel={() => setIsDeleteModalVisible(false)}
        okText="Delete"
        okButtonProps={{ danger: true }}
      >
        <p>Are you sure you want to delete the user {selectedUser?.username} ?</p>
        <p>This action cannot be undone and will remove all data associated with this user.</p>
      </Modal>

      {/* Assign Role Modal */}
      <Modal
        title={`Assign Role to ${selectedUser?.username}`}
        open={isRoleModalVisible}
        onCancel={() => setIsRoleModalVisible(false)}
        footer={null}
      >
        <Form form={roleForm} layout="vertical" onFinish={handleRoleSubmit}>
          <Form.Item
            name="roleId"
            label="Role"
            rules={[{ required: true, message: 'Please select a role!' }]}
          >
            <Select placeholder="Select a role">
              {roles.map((role) => (
                <Select.Option key={role._id} value={role._id}>
                  {role.name} ({role.scope})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          {/* Conditional fields based on selected role scope */}
          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.roleId !== currentValues.roleId}
          >
            {({ getFieldValue }) => {
              const roleId = getFieldValue('roleId');
              const selectedRole = roles.find((r) => r._id === roleId);

              if (selectedRole && selectedRole.scope === 'subreddit') {
                return (
                  <>
                    <Form.Item name="entityType" initialValue="subreddit" hidden={true}>
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name="entityId"
                      label="Subreddit"
                      rules={[{ required: true, message: 'Please select a subreddit!' }]}
                    >
                      <Select
                        placeholder="Select a subreddit"
                        showSearch
                        optionFilterProp="children"
                      >
                        {/* Normally would fetch this data */}
                        <Select.Option value="subreddit1">r/subreddit1</Select.Option>
                        <Select.Option value="subreddit2">r/subreddit2</Select.Option>
                      </Select>
                    </Form.Item>
                  </>
                );
              }
              return null;
            }}
          </Form.Item>

          <Form.Item className="mb-0 text-right">
            <Button onClick={() => setIsRoleModalVisible(false)} style={{ marginRight: 8 }}>
              Cancel
            </Button>
            <Button type="primary" htmlType="submit">
              Assign Role
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
