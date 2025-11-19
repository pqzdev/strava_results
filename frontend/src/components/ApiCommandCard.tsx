import React, { useState } from 'react';
import { ApiCommand, ApiParameter } from '../config/apiCommands';

interface ApiCommandCardProps {
  command: ApiCommand;
  apiUrl: string;
  adminStravaId?: number;
}

interface FormValues {
  [key: string]: any;
}

export const ApiCommandCard: React.FC<ApiCommandCardProps> = ({ command, apiUrl, adminStravaId }) => {
  const [formValues, setFormValues] = useState<FormValues>(() => {
    const initial: FormValues = {};
    command.parameters?.forEach(param => {
      if (param.default !== undefined) {
        initial[param.name] = param.default;
      }
    });
    return initial;
  });
  const [isExecuting, setIsExecuting] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (paramName: string, value: any) => {
    setFormValues(prev => ({ ...prev, [paramName]: value }));
  };

  const buildEndpoint = (): string => {
    let endpoint = command.endpoint;
    // Replace path parameters like :stravaId with actual values
    const pathParams = endpoint.match(/:\w+/g);
    if (pathParams) {
      pathParams.forEach(param => {
        const paramName = param.slice(1); // Remove the ':'
        const value = formValues[paramName];
        if (value) {
          endpoint = endpoint.replace(param, String(value));
        }
      });
    }
    return endpoint;
  };

  const buildRequestBody = (): any => {
    if (command.method === 'GET') return null;

    const body: any = {};

    // Automatically inject admin_strava_id if provided
    // This is used for admin-only endpoints that require authentication
    if (adminStravaId) {
      body.admin_strava_id = adminStravaId;
      // Also add athlete_strava_id for race visibility endpoints
      if (command.endpoint.includes('/races/')) {
        body.athlete_strava_id = adminStravaId;
      }
    }

    command.parameters?.forEach(param => {
      // Skip path parameters (they're in the URL)
      if (command.endpoint.includes(`:${param.name}`)) return;

      const value = formValues[param.name];
      if (value !== undefined && value !== '') {
        // Handle JSON type
        if (param.type === 'json') {
          try {
            body[param.name] = JSON.parse(value);
          } catch (e) {
            // If JSON parsing fails, will be caught in validation
          }
        } else if (param.type === 'checkbox') {
          body[param.name] = Boolean(value);
        } else if (param.type === 'number') {
          body[param.name] = Number(value);
        } else {
          body[param.name] = value;
        }
      }
    });
    return Object.keys(body).length > 0 ? body : null;
  };

  const validateForm = (): string | null => {
    if (!command.parameters) return null;

    for (const param of command.parameters) {
      const value = formValues[param.name];

      if (param.required && (value === undefined || value === '')) {
        return `${param.label} is required`;
      }

      if (param.type === 'json' && value) {
        try {
          JSON.parse(value);
        } catch (e) {
          return `${param.label} must be valid JSON`;
        }
      }

      if (param.type === 'number' && value !== undefined && value !== '') {
        const num = Number(value);
        if (isNaN(num)) {
          return `${param.label} must be a number`;
        }
        if (param.validation?.min !== undefined && num < param.validation.min) {
          return `${param.label} must be at least ${param.validation.min}`;
        }
        if (param.validation?.max !== undefined && num > param.validation.max) {
          return `${param.label} must be at most ${param.validation.max}`;
        }
      }

      if (param.type === 'text' && param.validation?.pattern && value) {
        const regex = new RegExp(param.validation.pattern);
        if (!regex.test(value)) {
          return `${param.label} format is invalid`;
        }
      }
    }

    return null;
  };

  const executeCommand = async () => {
    setError(null);
    setResponse(null);

    // Validate form
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    // Confirm dangerous operations
    if (command.dangerous || command.confirmMessage) {
      const message = command.confirmMessage || 'Are you sure you want to execute this command?';
      if (!window.confirm(message)) {
        return;
      }
    }

    setIsExecuting(true);

    try {
      // Normal API command execution
      const endpoint = buildEndpoint();
      const body = buildRequestBody();

      const fetchOptions: RequestInit = {
        method: command.method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (body) {
        fetchOptions.body = JSON.stringify(body);
      }

      const url = `${apiUrl}${endpoint}`;
      console.log(`Executing ${command.method} ${url}`, body);

      const res = await fetch(url, fetchOptions);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
      }

      setResponse(data);
      if (command.successMessage) {
        // Could add a toast notification here
        console.log(command.successMessage);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Command execution failed:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  const renderParameter = (param: ApiParameter) => {
    const value = formValues[param.name];

    switch (param.type) {
      case 'text':
      case 'number':
        return (
          <div key={param.name}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#374151', marginBottom: '0.25rem' }}>
              {param.label}
              {param.required && <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <input
              type={param.type}
              value={value || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              placeholder={param.placeholder}
              disabled={isExecuting}
              min={param.validation?.min}
              max={param.validation?.max}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.9rem',
                backgroundColor: isExecuting ? '#f9fafb' : 'white',
                color: '#111827',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = '#2563eb'}
              onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
            />
            {param.description && (
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                {param.description}
              </p>
            )}
          </div>
        );

      case 'textarea':
      case 'json':
        return (
          <div key={param.name}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#374151', marginBottom: '0.25rem' }}>
              {param.label}
              {param.required && <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <textarea
              value={value || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              placeholder={param.placeholder}
              rows={4}
              disabled={isExecuting}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontFamily: 'monospace',
                backgroundColor: isExecuting ? '#f9fafb' : 'white',
                color: '#111827',
                outline: 'none',
                transition: 'border-color 0.2s',
                resize: 'vertical',
              }}
              onFocus={(e) => e.target.style.borderColor = '#2563eb'}
              onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
            />
            {param.description && (
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                {param.description}
              </p>
            )}
          </div>
        );

      case 'select':
        return (
          <div key={param.name}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#374151', marginBottom: '0.25rem' }}>
              {param.label}
              {param.required && <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <select
              value={value || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              disabled={isExecuting}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.9rem',
                backgroundColor: isExecuting ? '#f9fafb' : 'white',
                color: '#111827',
                outline: 'none',
                transition: 'border-color 0.2s',
                cursor: isExecuting ? 'not-allowed' : 'pointer',
              }}
              onFocus={(e) => e.target.style.borderColor = '#2563eb'}
              onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
            >
              {!param.required && <option value="">-- Select --</option>}
              {param.options?.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {param.description && (
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                {param.description}
              </p>
            )}
          </div>
        );

      case 'checkbox':
        return (
          <div key={param.name}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: isExecuting ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => handleInputChange(param.name, e.target.checked)}
                disabled={isExecuting}
                style={{
                  marginRight: '0.5rem',
                  width: '1rem',
                  height: '1rem',
                  cursor: isExecuting ? 'not-allowed' : 'pointer',
                }}
              />
              <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#374151' }}>
                {param.label}
              </span>
            </label>
            {param.description && (
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem', marginLeft: '1.5rem' }}>
                {param.description}
              </p>
            )}
          </div>
        );

      case 'date':
        return (
          <div key={param.name}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#374151', marginBottom: '0.25rem' }}>
              {param.label}
              {param.required && <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <input
              type="date"
              value={value || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              disabled={isExecuting}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.9rem',
                backgroundColor: isExecuting ? '#f9fafb' : 'white',
                color: '#111827',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = '#2563eb'}
              onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
            />
            {param.description && (
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                {param.description}
              </p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{
      border: command.dangerous ? '2px solid #fca5a5' : '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '1.5rem',
      backgroundColor: command.dangerous ? '#fef2f2' : 'white',
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827', margin: 0 }}>
            {command.name}
            {command.dangerous && (
              <span style={{
                fontSize: '0.7rem',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                marginLeft: '0.5rem',
                fontWeight: 700,
              }}>
                <i className="fa-solid fa-triangle-exclamation"></i> DANGER
              </span>
            )}
          </h3>
        </div>
        <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.75rem' }}>
          {command.description}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            fontWeight: 600,
            backgroundColor: command.method === 'GET' ? '#d1fae5' :
                          command.method === 'POST' ? '#dbeafe' :
                          command.method === 'PATCH' ? '#fef3c7' :
                          '#fee2e2',
            color: command.method === 'GET' ? '#065f46' :
                   command.method === 'POST' ? '#1e40af' :
                   command.method === 'PATCH' ? '#92400e' :
                   '#991b1b',
          }}>
            {command.method}
          </span>
          <span style={{
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            padding: '0.25rem 0.5rem',
            backgroundColor: '#f3f4f6',
            color: '#374151',
            borderRadius: '4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '300px',
          }}>
            {command.endpoint}
          </span>
        </div>
      </div>

      {command.parameters && command.parameters.length > 0 && (
        <div style={{ marginBottom: '1rem', flex: 1 }}>
          <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151', marginBottom: '0.75rem' }}>
            Parameters
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {command.parameters.map(param => renderParameter(param))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 'auto' }}>
        <button
          onClick={executeCommand}
          disabled={isExecuting}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            fontWeight: 600,
            fontSize: '0.95rem',
            border: 'none',
            cursor: isExecuting ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            backgroundColor: command.dangerous
              ? (isExecuting ? '#fca5a5' : '#dc2626')
              : (isExecuting ? '#93c5fd' : '#2563eb'),
            color: 'white',
            opacity: isExecuting ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isExecuting) {
              e.currentTarget.style.backgroundColor = command.dangerous ? '#b91c1c' : '#1d4ed8';
            }
          }}
          onMouseLeave={(e) => {
            if (!isExecuting) {
              e.currentTarget.style.backgroundColor = command.dangerous ? '#dc2626' : '#2563eb';
            }
          }}
        >
          {isExecuting ? <><i className="fa-solid fa-spinner fa-spin"></i> Executing...</> : <><i className="fa-solid fa-play"></i> Execute Command</>}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
        }}>
          <p style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 600, margin: '0 0 0.25rem 0' }}>
            <i className="fa-solid fa-xmark"></i> Error
          </p>
          <p style={{ fontSize: '0.85rem', color: '#7f1d1d', margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {response && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          backgroundColor: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '6px',
        }}>
          <p style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
            <i className="fa-solid fa-check"></i> Response
          </p>
          <pre style={{
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            color: '#1e293b',
            overflow: 'auto',
            maxHeight: '200px',
            backgroundColor: 'white',
            padding: '0.75rem',
            borderRadius: '4px',
            border: '1px solid #e2e8f0',
            margin: 0,
          }}>
            {JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
