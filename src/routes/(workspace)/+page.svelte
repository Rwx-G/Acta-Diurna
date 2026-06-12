<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<!-- Never rendered: the load function always redirects to /reports. SvelteKit
     requires the component for the route to exist. -->
<a href={resolve('/reports')}>Reports</a>
