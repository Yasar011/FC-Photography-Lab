import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import BookingPlanner from '../components/BookingPlanner.jsx';

export default function BookLab() {
  const { profile } = useAuth();
  // /book?date=YYYY-MM-DD&start=17&end=18 opens the form with that slot (quick book).
  const [params] = useSearchParams();
  const pre = params.get('date')
    ? { date: params.get('date'), start: Number(params.get('start')), end: Number(params.get('end')) }
    : null;
  return <BookingPlanner key={params.toString()} student={profile} initialSelection={pre} />;
}
