'use client';
import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, message, Spin, Space } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import Layout from '../../components/Layout';

export default function RoleManagement() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [isAssignModalVisible, setIsAssignModalVisible] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [form] = Form.useForm();
  const [assignForm] = Form.useForm();

  // Check if user is admin
  useEffect(() => {
    if (status === 'authenticated') {
      if (!session.user.isAdmin) {
        message.error('You do not have permission to access this page');
        router.push('/');
      } else {
        fetchRoles();
        fetchUsers();
      }
    } else if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, session, router]);

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
      message.error('Failed to fetch roles');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/admin/users', {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
        },
      });
      setUsers(res.data.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleCreateRole = () => {
    form.resetFields();
    setSelectedRole(null);
    setIsModalVisible(true);
  };

  const handleEditRole = (role) => {
    setSelectedRole(role);
    form.setFieldsValue({
      name: role.name,
      scope: role.scope,
      description: role.description,
      permissions: role.permissions,
    });
    setIsModalVisible(true);
  };

  const handleDeleteRole = (role) => {
    setSelectedRole(role);
    setIsDeleteModalVisible(true);
  };

  const handleAssignRole = (role) => {
    setSelectedRole(role);
    assignForm.resetFields();
    setIsAssignModalVisible(true);
  };

  const confirmDelete = async () => {
    try {
      await axios.delete(`http://localhost:5000/api/admin/roles/${selectedRole._id}`, {
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
        },
      });
      message.success('Role deleted successfully');
      fetchRoles();
      setIsDeleteModalVisible(false);
    } catch (error) {
      console.error('Error deleting role:', error);
      message.error('Failed to delete role');
    }
  };

  const handleSubmitRole = async (values) => {
    try {
      if (selectedRole) {
        // Update existing role
        await axios.put(`http://localhost:5000/api/admin/roles/${selectedRole._id}`, values, {
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
        });
        message.success('Role updated successfully');
      } else {
        // Create new role
        await axios.post('http://localhost:5000/api/admin/roles', values, {
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
        });
        message.success('Role created successfully');
      }
      setIsModalVisible(false);
      fetchRoles();
    } catch (error) {
      console.error('Error saving role:', error);
      message.error('Failed to save role');
    }
  };

  const handleAssignSubmit = async (values) => {
    try {
      await axios.post(
        'http://localhost:5000/api/admin/role-assignments',
        {
          userId: values.userId,
          roleId: selectedRole._id,
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
      setIsAssignModalVisible(false);
    } catch (error) {
      console.error('Error assigning role:', error);
      message.error('Failed to assign role');
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text) => <a>{text}</a>,
    },
    {
      title: 'Scope',
      dataIndex: 'scope',
      key: 'scope',
      render: (scope) => (
        <Tag color={scope === 'global' ? 'blue' : scope === 'subreddit' ? 'green' : 'purple'}>
          {scope}
        </Tag>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: 'Permissions',
      dataIndex: 'permissions',
      key: 'permissions',
      render: (permissions) => (
        <div>
          {permissions &&
            permissions.map((perm) => (
              <Tag color="geekblue" key={perm}>
                {perm}
              </Tag>
            ))}
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => handleEditRole(record)} type="text" />
          <Button
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteRole(record)}
            type="text"
            danger
          />
          <Button onClick={() => handleAssignRole(record)} type="primary" size="small">
            Assign
          </Button>
        </Space>
      ),
    },
  ];

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
      <div className="pb-4 mb-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold">Role Management</h1>
      </div>

      <div className="mb-4">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateRole}>
          Create New Role
        </Button>
      </div>

      <Table columns={columns} dataSource={roles} rowKey="_id" />

      {/* Role Modal */}
      <Modal
        title={selectedRole ? 'Edit Role' : 'Create New Role'}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmitRole}>
          {/* Form fields */}
        </Form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        title="Confirm Delete"
        open={isDeleteModalVisible}
        onCancel={() => setIsDeleteModalVisible(false)}
        onOk={confirmDelete}
      >
        <p>Are you sure you want to delete the role {selectedRole?.name} ?</p>
        <p>This action cannot be undone.</p>
      </Modal>

      {/* Assign Role Modal */}
      <Modal
        title={`Assign ${selectedRole?.name} Role`}
        open={isAssignModalVisible}
        onCancel={() => setIsAssignModalVisible(false)}
        footer={null}
      >
        <Form form={assignForm} layout="vertical" onFinish={handleAssignSubmit}>
          {/* Form fields */}
        </Form>
      </Modal>
    </Layout>
  );
}
