import React from 'react';
import { render } from '@testing-library/react-native';
import App from '../src/App';

it('renderiza o título principal', () => {
  const { getByText } = render(<App />);
  expect(getByText(/coach pessoal/i)).toBeTruthy();
});