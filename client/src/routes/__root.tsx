import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Layout } from '../components/Layout/Layout';

export const Route = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});
