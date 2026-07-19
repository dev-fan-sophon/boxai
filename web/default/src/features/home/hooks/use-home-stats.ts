/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'

import { getHomeStats } from '../api'

export function useHomeStats() {
  return useQuery({
    queryKey: ['home', 'stats'],
    queryFn: getHomeStats,
    staleTime: 5 * 60 * 1000,
  })
}
