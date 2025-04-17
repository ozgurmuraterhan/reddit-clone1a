import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import GithubProvider from 'next-auth/providers/github';
import axios from 'axios';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          const response = await axios.post(`${apiUrl}/auth/login`, {
            email: credentials.email,
            password: credentials.password,
          });

          if (response.data.success) {
            return {
              id: response.data.data.user._id,
              name: response.data.data.user.username,
              email: response.data.data.user.email,
              image: response.data.data.user.profilePicture,
              role: response.data.data.user.role,
              isAdmin: response.data.data.user.role === 'admin',
              accessToken: response.data.data.token,
            };
          }
          return null;
        } catch (error) {
          console.error('Login error:', error.response?.data || error.message);
          throw new Error(error.response?.data?.error || 'Invalid credentials');
        }
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    GithubProvider({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      // ... (devam)
      // Initial sign in
      if (account && user) {
        if (account.provider === 'credentials') {
          return {
            ...token,
            accessToken: user.accessToken,
            role: user.role,
            isAdmin: user.isAdmin,
          };
        } else {
          // For OAuth providers, handle the token
          try {
            // Pass the OAuth details to backend to register/login
            const response = await axios.post(`${apiUrl}/auth/${account.provider}`, {
              id: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
              accessToken: account.access_token,
            });

            return {
              ...token,
              accessToken: response.data.data.token,
              role: response.data.data.user.role,
              isAdmin: response.data.data.user.role === 'admin',
            };
          } catch (error) {
            console.error('OAuth error:', error);
            return { ...token };
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Send properties to the client
      session.user.id = token.sub;
      session.user.role = token.role;
      session.user.isAdmin = token.isAdmin;
      session.accessToken = token.accessToken;

      return session;
    },
    async redirect({ url, baseUrl }) {
      // Customize redirect after sign-in
      return baseUrl;
    },
  },
  pages: {
    signIn: '/login',
    signUp: '/register',
    error: '/error',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
