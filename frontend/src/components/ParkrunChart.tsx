import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useState, useEffect } from 'react';
import './ParkrunChart.css';

interface DateData {
  date: string;
  run_count: number;
  event_count: number;
}

interface ParkrunChartProps {
  filters: {
    athletes: string[];
    events: string[];
    dateFrom: string;
    dateTo: string;
  };
  onDateClick: (date: string) => void;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: DateData;
  }>;
}

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const formattedDate = new Date(data.date).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    return (
      <div className="chart-tooltip">
        <p className="tooltip-date">{formattedDate}</p>
        <p className="tooltip-runs">Runs: {data.run_count}</p>
        <p className="tooltip-events">Events: {data.event_count}</p>
      </div>
    );
  }
  return null;
};

export default function ParkrunChart({ filters, onDateClick }: ParkrunChartProps) {
  const [data, setData] = useState<DateData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchData();
  }, [filters]);

  async function fetchData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      filters.athletes.forEach(athlete => params.append('athlete', athlete));
      filters.events.forEach(event => params.append('event', event));
      if (filters.dateFrom) params.append('date_from', filters.dateFrom);
      if (filters.dateTo) params.append('date_to', filters.dateTo);

      const response = await fetch(`/api/parkrun/by-date?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      setData(result.data || []);
    } catch (error) {
      console.error('Error fetching parkrun chart data:', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="parkrun-chart-container">
        <div className="chart-loading">Loading chart...</div>
      </div>
    );
  }

  if (data.length === 0) {
    return null; // Don't show chart if no data
  }

  // Calculate tick interval to show approximately 10-15 date labels
  const tickInterval = Math.max(1, Math.floor(data.length / 12));

  return (
    <div className="parkrun-chart-container">
      <h3 className="chart-title">Parkrun Activity Over Time</h3>
      <p className="chart-subtitle">Click any bar to filter by date</p>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart
          data={data}
          margin={{ top: 20, right: 10, left: 0, bottom: 20 }}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            interval={tickInterval}
            angle={-45}
            textAnchor="end"
            height={60}
            tickFormatter={(value: string) => {
              const date = new Date(value);
              const month = date.toLocaleDateString('en-US', { month: 'short' });
              const year = date.getFullYear().toString().slice(-2);
              return `${month}'${year}`;
            }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            label={{ value: 'Runs', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
            domain={[0, 'dataMax']}
            allowDataOverflow={false}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: 'rgba(102, 126, 234, 0.1)' }}
            isAnimationActive={false}
          />
          <Bar
            dataKey="run_count"
            fill="#667eea"
            minPointSize={0}
            onClick={(data: any) => {
              if (data && data.date) {
                onDateClick(data.date);
              }
            }}
            onMouseEnter={(_: any, index: number) => setHoveredIndex(index)}
            cursor="pointer"
          >
            {data.map((_, index: number) => (
              <Cell
                key={`cell-${index}`}
                fill={hoveredIndex === index ? '#764ba2' : '#667eea'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
