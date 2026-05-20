import { useLocalSearchParams } from 'expo-router';
import { LearnerSectionScreen } from './section/[id]';

export default function ContentRouteScreen() {
  const { route } = useLocalSearchParams<{ route?: string | string[] }>();
  const parts = Array.isArray(route) ? route : route ? [route] : [];
  const sectionRoute = `/${parts.filter(Boolean).join('/')}`;

  return <LearnerSectionScreen sectionRoute={sectionRoute === '/' ? '/' : sectionRoute} />;
}
