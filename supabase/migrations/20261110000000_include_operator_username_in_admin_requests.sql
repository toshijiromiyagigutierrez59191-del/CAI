drop function if exists public.cai_admin_solicitudes_pendientes();

create function public.cai_admin_solicitudes_pendientes()
returns table (
  id uuid,
  nombre_completo text,
  cedula text,
  usuario text,
  telefono text,
  establecimiento_nombre text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.cai_admin_es_autorizado() then
    raise exception 'No tiene permisos para administrar las solicitudes.' using errcode = '42501';
  end if;

  return query
    select operador.id,
           operador.nombre_completo,
           operador.cedula,
           operador.usuario,
           operador.telefono,
           establecimiento.nombre,
           operador.created_at
      from public.cai_operadores as operador
      join public.cai_establecimientos as establecimiento
        on establecimiento.id = operador.establecimiento_id
     where operador.estado = 'pendiente'
     order by operador.created_at asc;
end;
$$;

revoke all on function public.cai_admin_solicitudes_pendientes() from public, anon;
grant execute on function public.cai_admin_solicitudes_pendientes() to authenticated;

notify pgrst, 'reload schema';
