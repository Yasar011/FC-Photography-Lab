import { useAuth } from '../lib/auth.jsx';
import BookingPlanner from '../components/BookingPlanner.jsx';

export default function BookLab() {
  const { profile } = useAuth();
  return <BookingPlanner student={profile} />;
}
