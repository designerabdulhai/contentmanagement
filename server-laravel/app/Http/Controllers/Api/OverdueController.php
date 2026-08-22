<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ScheduledPost;

class OverdueController extends Controller
{
    public function check(){
        $updated = ScheduledPost::where('status','scheduled')->where('scheduled_at','<', now())->update(['is_overdue'=>true]);
        return response()->json(['updated'=>$updated]);
    }
}
