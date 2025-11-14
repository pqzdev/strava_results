import React, { useState } from 'react';
import { ApiCommand, ApiParameter } from '../config/apiCommands';

interface ApiCommandCardProps {
  command: ApiCommand;
  apiUrl: string;
}

interface FormValues {
  [key: string]: any;
}

export const ApiCommandCard: React.FC<ApiCommandCardProps> = ({ command, apiUrl }) => {
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
          <div key={param.name} className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {param.label}
              {param.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type={param.type}
              value={value || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              placeholder={param.placeholder}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isExecuting}
              min={param.validation?.min}
              max={param.validation?.max}
            />
            {param.description && (
              <p className="text-xs text-gray-500 mt-1">{param.description}</p>
            )}
          </div>
        );

      case 'textarea':
      case 'json':
        return (
          <div key={param.name} className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {param.label}
              {param.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <textarea
              value={value || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              placeholder={param.placeholder}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              rows={4}
              disabled={isExecuting}
            />
            {param.description && (
              <p className="text-xs text-gray-500 mt-1">{param.description}</p>
            )}
          </div>
        );

      case 'select':
        return (
          <div key={param.name} className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {param.label}
              {param.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
              value={value || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isExecuting}
            >
              {!param.required && <option value="">-- Select --</option>}
              {param.options?.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {param.description && (
              <p className="text-xs text-gray-500 mt-1">{param.description}</p>
            )}
          </div>
        );

      case 'checkbox':
        return (
          <div key={param.name} className="mb-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => handleInputChange(param.name, e.target.checked)}
                className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                disabled={isExecuting}
              />
              <span className="text-sm font-medium text-gray-700">{param.label}</span>
            </label>
            {param.description && (
              <p className="text-xs text-gray-500 mt-1 ml-6">{param.description}</p>
            )}
          </div>
        );

      case 'date':
        return (
          <div key={param.name} className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {param.label}
              {param.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="date"
              value={value || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isExecuting}
            />
            {param.description && (
              <p className="text-xs text-gray-500 mt-1">{param.description}</p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className={`border rounded-lg p-4 ${command.dangerous ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className="mb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              {command.name}
              {command.dangerous && (
                <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">DANGER</span>
              )}
            </h3>
            <p className="text-sm text-gray-600 mt-1">{command.description}</p>
            <div className="flex gap-2 mt-2">
              <span className={`text-xs font-mono px-2 py-1 rounded ${
                command.method === 'GET' ? 'bg-green-100 text-green-800' :
                command.method === 'POST' ? 'bg-blue-100 text-blue-800' :
                command.method === 'PATCH' ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {command.method}
              </span>
              <span className="text-xs font-mono px-2 py-1 bg-gray-100 text-gray-700 rounded">
                {command.endpoint}
              </span>
            </div>
          </div>
        </div>
      </div>

      {command.parameters && command.parameters.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Parameters</h4>
          {command.parameters.map(param => renderParameter(param))}
        </div>
      )}

      <div className="mb-4">
        <button
          onClick={executeCommand}
          disabled={isExecuting}
          className={`w-full px-4 py-2 rounded-md font-medium transition-colors ${
            command.dangerous
              ? 'bg-red-600 hover:bg-red-700 text-white disabled:bg-red-300'
              : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-300'
          } disabled:cursor-not-allowed`}
        >
          {isExecuting ? 'Executing...' : 'Execute Command'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800 font-medium">Error</p>
          <p className="text-sm text-red-700 mt-1">{error}</p>
        </div>
      )}

      {response && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
          <p className="text-sm text-gray-800 font-medium mb-2">Response</p>
          <pre className="text-xs text-gray-700 overflow-auto max-h-64 bg-white p-2 rounded border border-gray-200">
            {JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
