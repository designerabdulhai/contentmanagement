<?php

use Illuminate\Support\Facades\Route;
use App\Models\ScheduledPost;
use Illuminate\Http\Request;

Route::get('/fullcalendar-events', function(){
    return ScheduledPost::whereNotNull('scheduled_at')->get()->map(function($p){
        return [ 'id'=>$p->id, 'title'=>$p->project_name?:'Untitled', 'start'=>$p->scheduled_at, 'extendedProps'=>['status'=>$p->status,'channel'=>$p->channel] ];
    });
});

Route::post('/posts/{id}/reschedule', function(Request $r, $id){
    $p = ScheduledPost::findOrFail($id);
    $p->scheduled_at = $r->input('scheduled_at');
    $p->is_overdue = false;
    $p->save();
    return response()->json(['ok'=>true]);
});

Route::post('/overdue/check', [App\Http\Controllers\Api\OverdueController::class,'check']);
